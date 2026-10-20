# 5. Rate limiting

## Vì sao cần rate limit?

- **Brute force:** không có giới hạn, kẻ tấn công có thể thử hàng nghìn mật khẩu mỗi phút trên `/auth/login`.
- **Lạm dụng / sự cố:** một client lỗi bị kẹt trong vòng lặp retry có thể làm quá tải một EC2 nhỏ.
- **Công bằng:** một client dùng nhiều không được làm chậm mọi người khác.

## Thuật toán: fixed window

Code: [rate-limit/rate-limit.middleware.ts](../src/rate-limit/rate-limit.middleware.ts).

Thời gian được chia thành các cửa sổ (window) dài `RATE_LIMIT_WINDOW_MS`
(mặc định 60 giây). Mỗi client có một bộ đếm (**bucket**) cho mỗi cửa sổ:

```
bucket = { count, resetAt }

khi có request:
  nếu chưa có bucket, hoặc now >= resetAt:  mở cửa sổ mới: count = 1, resetAt = now + window → cho qua
  ngược lại nếu count >= limit:            từ chối 429, Retry-After = số giây tới resetAt
  ngược lại:                               count += 1 → cho qua
```

Ví dụ với limit 3, cửa sổ 60 giây:

```
t=0s   req → bucket mới {1, reset@60}   ✅
t=5s   req → {2}                         ✅
t=9s   req → {3}                         ✅
t=20s  req → count 3 ≥ 3                 ❌ 429, Retry-After: 40
t=61s  req → hết cửa sổ → {1, reset@121} ✅
```

### Hai nhóm giới hạn

```ts
const isAuthEndpoint = RequestPath.of(request).includes('/auth/');
const bucketKey = `${request.ip}:${isAuthEndpoint ? 'auth' : 'api'}`;
```

| Nhóm | Biến env | Mặc định | Lý do |
|---|---|---|---|
| Path chứa `/auth/` | `AUTH_RATE_LIMIT_MAX` | 10 / cửa sổ | Login và đặt lại mật khẩu là mục tiêu brute force |
| Mọi path khác | `RATE_LIMIT_MAX` | 120 / cửa sổ | Dùng app bình thường |

Hai bucket tách riêng nên lướt app không làm hết lượt login, và ngược lại.

### Ưu nhược điểm của fixed window

Đơn giản và rẻ (mỗi request một lần tra map), nhưng cho phép **burst ở ranh
giới cửa sổ**: client có thể gửi `limit` request ở giây 59 và thêm `limit`
request ở giây 61, tức gấp đôi giới hạn trong khoảng hai giây. Các lựa chọn khác:

| Thuật toán | Ý tưởng | Chi phí |
|---|---|---|
| Fixed window (đang dùng) | Bộ đếm reset sau mỗi cửa sổ | Nhỏ nhất |
| Sliding window log | Lưu thời điểm từng request, đếm những cái trong N giây gần nhất | Bộ nhớ tăng theo traffic |
| Sliding window counter | Trộn có trọng số số đếm của cửa sổ hiện tại và cửa sổ trước | Nhỏ, mượt hơn |
| Token bucket | Token được nạp lại đều đặn; mỗi request tiêu một token | Nhỏ, cho phép burst có kiểm soát |

Với hệ thống quy mô demo, fixed window là lựa chọn hợp lý.

## Client là ai?

Khoá bucket dùng `request.ip`. Đứng sau Caddy, kết nối TCP luôn đến từ IP
container của Caddy. Nếu không thiết lập gì thêm, **mọi người dùng sẽ chung một bucket**.

Caddy thêm IP thật của client vào header `X-Forwarded-For`. Trong
[main.ts](../src/main.ts):

```ts
app.set('trust proxy', 1);
```

Câu này nói với Express: "tin đúng **một** lớp proxy; lấy IP client từ mục
cuối cùng của `X-Forwarded-For`". Giá trị là số là có chủ đích:

- `trust proxy = true` sẽ tin *toàn bộ* header, mà client thì ghi gì vào đó
  cũng được (`X-Forwarded-For: 1.2.3.4`), mỗi request một IP giả để né giới hạn.
- `1` khớp đúng topology thực tế (client → Caddy → gateway). Caddy *nối thêm*
  IP nó thực sự nhìn thấy vào cuối, và đó chính là mục ta đọc.

Nếu sau này thêm một proxy nữa phía trước (ví dụ load balancer), số này phải đổi thành `2`.

### Chung IP

Những người dùng sau cùng một NAT (wifi lớp học, ký túc xá) có chung một IP
public nên chung một bucket. Khi demo trực tiếp với 20 người cùng wifi,
`AUTH_RATE_LIMIT_MAX=10` có thể khoá login của cả lớp trong một phút. Hãy tăng
lên trong ngày demo (ví dụ 50).

## Giữ bộ nhớ sạch

Mỗi IP mới tạo ra một entry trong map. Không dọn thì map lớn mãi. Trên con
t3.micro 1 GB RAM, điều đó dần thành rò rỉ bộ nhớ.

```ts
this.sweepInterval = setInterval(() => this.sweepExpiredBuckets(), config.rateLimitWindowMs);
this.sweepInterval.unref();
```

- Mỗi cửa sổ một lần, các bucket hết hạn bị xoá.
- `.unref()` nói với Node "chỉ riêng timer này thì đừng giữ process sống", để
  việc tắt app không bị chặn.
- `onModuleDestroy()` huỷ timer khi Nest tắt.

## Giới hạn

- **Theo từng process.** Bucket nằm trong bộ nhớ của process này. Chạy hai
  bản gateway thì mỗi bản cho phép đủ giới hạn, và restart sẽ reset mọi bộ đếm.
  Muốn scale ra nhiều bản, chuyển bộ đếm sang Redis (`INCR` + `EXPIRE` cho mỗi
  key) hoặc dùng thư viện như `@nestjs/throttler` với Redis store.
- **So khớp chuỗi con `/auth/`** khá thô: bất kỳ path nào sau này có chứa
  `/auth/` cũng rơi vào nhóm giới hạn chặt.

## Response

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 40
Content-Type: application/json

{"statusCode":429,"code":"RATE_LIMITED"}
```

Client nên đọc `Retry-After` và chờ, thay vì retry ngay lập tức.
