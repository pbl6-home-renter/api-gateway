# 4. Proxy

## Khái niệm: reverse proxy

**Reverse proxy** nhận request từ client, tự mở một request mới tới backend,
rồi chuyển response của backend về cho client. Client không bao giờ nói
chuyện trực tiếp với backend. Caddy là một reverse proxy; bước cuối của gateway cũng vậy.

Proxy nghe thì đơn giản ("cứ chuyển tiếp thôi") nhưng có nhiều cạm bẫy thật:
body request, những header chỉ có nghĩa trên một kết nối, timeout, và lỗi.
Gateway dùng [`http-proxy-middleware`](https://github.com/chimurai/http-proxy-middleware)
(xây trên `http-proxy`) thay vì tự viết bằng `fetch`, vì thư viện này đã xử lý sẵn các chi tiết đó.

Code: [proxy/proxy.middleware.ts](../src/proxy/proxy.middleware.ts).

```ts
createProxyMiddleware({
  changeOrigin: true,
  timeout: config.proxyTimeoutMs,
  proxyTimeout: config.proxyTimeoutMs,
  router: (request) => request.gatewayRoute!.baseUrl!,   // chọn host theo từng request
  pathRewrite: (_path, request) => request.originalUrl,  // giữ nguyên path + query
  on: { proxyReq: ..., error: ... },
});
```

## Stream và buffer

Có hai cách chuyển tiếp body request:

| | Buffer | Stream — cách đang dùng |
|---|---|---|
| Cách làm | Đọc toàn bộ body vào bộ nhớ, parse, rồi gửi lại | Đẩy từng byte từ socket client sang socket backend ngay khi nhận được |
| Bộ nhớ | Tăng theo kích thước body | Không đổi |
| Kiểu nội dung | Chỉ những gì mình parse được (ví dụ JSON) | Mọi thứ: JSON, upload multipart, binary |
| Độ trễ | Phải chờ nhận đủ body | Chuyển tiếp ngay |

Phiên bản đầu của gateway dùng buffer: Nest parse JSON, rồi gateway serialize
lại `request.body`. Upload multipart (ảnh phòng, file hợp đồng PDF) bị chuyển
tới backend với body **rỗng** mà không báo lỗi gì, vì body parser không xử lý kiểu đó.

Muốn stream chỉ cần một thiết lập trong [main.ts](../src/main.ts):

```ts
NestFactory.create(AppModule, { bodyParser: false });
```

Nếu body parser chạy trước, nó sẽ đọc hết stream và không còn gì để chuyển
tiếp. Tắt nó đi thì gateway không bao giờ đụng tới body, và điều đó không sao:
không quyết định nào của gateway (route, auth, rate limit) cần đến body.

## Header

### `changeOrigin: true`

Đổi header `Host` thành host của backend (`tenancy:3002`) thay vì host phía
client (`203.0.113.7`). Backend và framework của nó đều mong `Host` là tên của chính nó.

### Header hop-by-hop

HTTP phân biệt header **end-to-end** (dành cho bên nhận cuối cùng, ví dụ
`Authorization`, `Content-Type`) với header **hop-by-hop**, chỉ mô tả một kết
nối TCP duy nhất (RFC 7230 §6.1):

```
connection, keep-alive, proxy-authenticate, proxy-authorization,
te, trailer, transfer-encoding, upgrade
```

Kết nối client→gateway và gateway→backend là hai kết nối khác nhau, nên proxy
không được chép các header này sang. Ví dụ chép `transfer-encoding: chunked`
trong khi body đã được đóng khung lại theo cách khác có thể làm hỏng message.
Gateway xoá chúng một cách tường minh (`HOP_BY_HOP_HEADERS`).

### Header gateway tự thêm

Trong hook `proxyReq`, ngay trước khi request tới backend được gửi đi:

1. Xoá `x-user-id` / `x-user-role` do client gửi (chống giả mạo; xem
   [Xác thực](03-authentication.md)).
2. Xoá các header hop-by-hop.
3. Đặt `x-correlation-id`.
4. Đặt `x-user-id` / `x-user-role` lấy từ token đã verify, nếu có.

## Correlation ID

Một thao tác của người dùng có thể đi qua nhiều service: gateway → tenancy →
(RabbitMQ) → payment. Khi có lỗi, bạn cần tìm mọi dòng log của *đúng thao tác
đó* trên tất cả service. **Correlation ID** là một ID ngẫu nhiên gắn vào
request và được chuyền theo qua mọi bước.

[CorrelationId.resolve()](../src/common/correlation-id.ts):

- Nếu bên gọi đã gửi `x-correlation-id` (≤ 128 ký tự) thì dùng lại. Nhờ vậy web
  app có thể hiện ID này trong hộp thoại lỗi để người dùng báo bug.
- Nếu không thì tạo một UUID mới.

Giới hạn độ dài ngăn người gọi nhét giá trị khổng lồ vào mọi dòng log.
**Các service nên ghi header này vào mỗi dòng log**, và chuyền tiếp nó trong
các lời gọi ra ngoài và message RabbitMQ của mình.

## Timeout

| Option | Ý nghĩa |
|---|---|
| `proxyTimeout` | Thời gian tối đa chờ backend trả lời |
| `timeout` | Thời gian rảnh tối đa trên socket của client gửi tới |

Cả hai dùng `PROXY_TIMEOUT_MS` (mặc định 10 giây). Không có timeout, một
backend bị treo sẽ giữ kết nối của gateway mãi mãi; khi tải cao gateway hết
socket và *mọi thứ* dừng lại, không riêng service bị lỗi.

## Lỗi upstream

Hook `error` biến lỗi mạng thành JSON:

| Tình huống | Response |
|---|---|
| Backend từ chối kết nối (`ECONNREFUSED`: container tắt hoặc đang restart) | `503 UPSTREAM_UNAVAILABLE` |
| Mọi lỗi khác (timeout, đứt kết nối, lỗi DNS) | `504 UPSTREAM_TIMEOUT` |

Hai điều kiện bảo vệ trong handler:

- `if (res.headersSent) return;`: nếu backend đã bắt đầu gửi response rồi mới
  chết, status line đã gửi đi mất; không thể thay bằng JSON được nữa.
- `if (!('headersSent' in res))`: với WebSocket upgrade, tham số thứ ba là một
  socket thô chứ không phải HTTP response, nên chỉ đóng nó lại.

> **Giới hạn đã biết:** lỗi DNS (đã đặt URL service nhưng container chưa tồn
> tại) bị báo là `504` thay vì `503`. Nếu thấy khó hiểu, hãy map thêm
> `ENOTFOUND` sang `503`.

Lỗi do backend *trả về* (400/403/500 của chính nó) không phải lỗi của proxy.
Chúng được chuyển nguyên vẹn cả body về client.

## Những gì proxy không làm

- **WebSocket**: chưa bật upgrade (không đặt `ws: true`). Chat realtime sẽ cần
  bật nó, hoặc thêm một route riêng ở Caddy.
- **Retry**: request lỗi không được gửi lại. Retry các request không idempotent
  (`POST /payments`) qua gateway có thể trừ tiền người dùng hai lần.
- **Biến đổi response**: response được stream nguyên vẹn.
