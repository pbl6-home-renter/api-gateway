# 2. Routing

## Khái niệm: định tuyến theo prefix

Với mỗi request, gateway phải trả lời một câu: *service nào sở hữu path này?*
Câu trả lời nằm trong một **bảng route** gồm các prefix:

```
/api/v1/auth       → Identity
/api/v1/rooms      → Tenancy
/api/v1/payments   → Payment
...
```

Một prefix "sở hữu" chính nó và mọi thứ bên dưới: `/api/v1/rooms` khớp với
`/api/v1/rooms`, `/api/v1/rooms/42` và `/api/v1/rooms/42/photos`.

## Code nằm ở đâu

| File | Vai trò |
|---|---|
| [constants/route-paths.constants.ts](../src/constants/route-paths.constants.ts) | `API_PREFIX`, `ROUTE_DEFINITIONS` (prefix → service, sinh từ `ROUTE_PREFIXES`), `PUBLIC_RULES` |
| [constants/gateway-service.enum.ts](../src/constants/gateway-service.enum.ts) | Enum `GatewayService` và tên biến env chứa URL của từng service |
| [routing/route-table.service.ts](../src/routing/route-table.service.ts) | Ghép định nghĩa route với URL đã cấu hình; `resolve()`, `isPublic(method, path)` |
| [routing/route-resolver.middleware.ts](../src/routing/route-resolver.middleware.ts) | Gắn `request.gatewayRoute` hoặc trả `404` |

Bảng route được tách làm hai phần có chủ đích:

- **Có những route nào** là dữ liệu tĩnh (`ROUTE_DEFINITIONS`), commit vào git.
- **Mỗi service chạy ở đâu** (`http://tenancy:3002`) là cấu hình triển khai (biến env).

`RouteTableService` ghép hai phần này một lần lúc khởi động.

## Quy tắc so khớp

### So khớp prefix theo từng đoạn path

```ts
path === prefix || path.startsWith(`${prefix}/`)
```

Phần kiểm tra `/` rất quan trọng. Nếu chỉ dùng `startsWith(prefix)`, prefix
`/api/v1/me` sẽ khớp luôn `/api/v1/members` và đẩy request sang nhầm service.
Bắt buộc khớp chính xác hoặc có `/` theo sau nghĩa là chỉ khớp trọn từng đoạn path.

### Prefix dài nhất thắng

Nếu nhiều prefix cùng khớp, prefix dài nhất (cụ thể nhất) được chọn:

```ts
.sort((left, right) => right.prefix.length - left.prefix.length)[0]
```

Nhờ vậy sau này có thể tách một nhánh con sang service khác, ví dụ
`/api/v1/rooms` → Tenancy nhưng `/api/v1/rooms/reviews` → Community. Thứ tự
khai báo trong `ROUTE_DEFINITIONS` không ảnh hưởng.

### Service chưa cấu hình thì trả 404

Nếu route khớp nhưng biến env URL của service đó trống (ví dụ Payment chưa
deploy), `baseUrl` là `undefined` và resolver trả `404 ROUTE_NOT_FOUND`. Với
client, API đó coi như chưa tồn tại.

## Path được chuyển tiếp nguyên vẹn

Path phía client và path phía backend giống hệt nhau:

```
Client:   GET /api/v1/rooms/42?status=free
Backend:  GET http://tenancy:3002/api/v1/rooms/42?status=free
```

Gateway chỉ chọn **host**, không bao giờ sửa path. Nhờ vậy mọi service backend
chỉ cần theo một quy ước đơn giản:

```ts
// trong main.ts của mỗi service
app.setGlobalPrefix('api/v1');

// controller chỉ đặt tên resource
@Controller('rooms')            // → /api/v1/rooms
```

Lợi ích:

- Path trong Swagger của service đúng bằng path client gọi, đồng bộ sang Apidog dùng luôn được.
- Có thể gọi thẳng service trong mạng Docker bằng cùng path
  (`http://tenancy:3002/api/v1/rooms`), debug rất tiện.

> Vì sao không thêm tên service vào path (`/tenancy-service/api/v1/...`)?
> Mỗi service đã có host riêng nên gateway phân biệt được mà không cần nó.
> Thêm prefix tên service chỉ sinh ra một bước rewrite và làm path trong
> Swagger khác với path client gọi.

## Health và Swagger của từng service

`/health` thuộc về gateway (gateway tự trả lời, không chuyển tiếp). Health và
Swagger của service backend nằm dưới một prefix riêng theo tên service, để
mỗi path vẫn thuộc đúng một service:

| Path | Ý nghĩa |
|---|---|
| `/api/v1/<service>/health` | Health check của service (dự kiến do gateway kiểm tra, chưa làm) |
| `/api/v1/<service>/swagger` | Swagger UI; JSON ở `/api/v1/<service>/swagger/json` (dùng cho Apidog) |

Trong service:

```ts
@Controller('identity/health')
SwaggerModule.setup('identity/swagger', app, document, {
  useGlobalPrefix: true,
  jsonDocumentUrl: 'identity/swagger/json',
});
```

Trong gateway: khai báo tên đoạn path của service trong `SERVICE_PATHS`; route
`${API_PREFIX}/<service>` và hai rule public `GET .../health`, `GET .../swagger/**`
được sinh tự động.

### Path `/me/*` thuộc nhiều service

`/api/v1/me` thuộc Identity, nhưng `/me/buildings`, `/me/contracts`,
`/me/payments`, `/me/issues`… thuộc service sở hữu dữ liệu đó. Mỗi path con này
được khai báo riêng trong `ROUTE_PREFIXES` và thắng `/me` nhờ quy tắc prefix dài
nhất. Khi spec thêm một `/me/<resource>` mới, phải thêm nó vào service đúng,
nếu không request sẽ rơi vào Identity và trả `404`.

## Thêm route mới

Giả sử Tenancy thêm `MaintenanceRequestsController`:

1. **Trong service:** `@Controller('maintenance-requests')`, nằm dưới global prefix `api/v1`.
2. **Trong gateway**, thêm `'/maintenance-requests'` vào danh sách của
   `GatewayService.Tenancy` trong `ROUTE_PREFIXES`.
3. **Nếu có endpoint cần gọi được khi chưa đăng nhập**, thêm một rule
   `{ method, path }` vào `PUBLIC_RULES` (xem [Xác thực](03-authentication.md)),
   **và** đánh dấu `@Public()` trong service.
4. Deploy service trước, gateway sau. Làm ngược lại thì path mới sẽ trả
   `503`/`504` trong lúc chờ.

Quy tắc đặt tên: danh từ số nhiều, kebab-case (`buildings`, `maintenance-requests`).
**Mỗi tên resource chỉ thuộc về đúng một service.** Hai service không thể cùng sở hữu `/api/v1/rooms`.

## Thêm service mới

1. Thêm một giá trị vào enum `GatewayService` và tên biến env vào `SERVICE_URL_ENV_VAR`:
   ```ts
   Notification = 'NOTIFICATION',
   // ...
   [GatewayService.Notification]: 'NOTIFICATION_SERVICE_URL',
   ```
   `SERVICE_URL_ENV_VAR` có kiểu `Record<GatewayService, string>`, nên compiler
   bắt buộc bạn khai báo biến env. Quên là lỗi build, không phải lỗi lúc chạy.
2. Thêm các prefix của nó vào `ROUTE_PREFIXES` và tên đoạn path vào `SERVICE_PATHS`.
3. Thêm `NOTIFICATION_SERVICE_URL=http://notification:3005` vào `.env.example`
   và `infra/env/api-gateway.env.example`, rồi vào file env thật trên EC2.
4. Thêm service vào `infra/docker-compose.prod.yml` bằng `expose`, **không** dùng `ports`.

## Gọi giữa các service

Các service gọi nhau **trực tiếp** trong private network hoặc qua RabbitMQ, không
bao giờ đi vòng qua gateway:

- Nếu đang xử lý request của một user, chuyển tiếp nguyên `Authorization` của
  user đó: service nhận verify như mọi request khác.
- Nếu là lời gọi hệ thống (không có user), gọi endpoint `internal/...` (nằm
  ngoài prefix `api/v1`, gateway trả `404`) kèm header `X-Service-Token`. Service
  đánh dấu endpoint bằng `@InternalOnly()`.
