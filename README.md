# Rentify API Gateway

Bộ tài liệu này dạy hai thứ cùng lúc: gateway này hoạt động như thế nào, và
các kiến thức nền tảng đằng sau nó. Mỗi trang mở đầu bằng khái niệm, sau đó
chỉ ra đúng đoạn code hiện thực khái niệm đó.

Thứ tự nên đọc:

| # | Trang | Bạn sẽ học được |
|---|---|---|
| 1 | [Kiến trúc & vòng đời request](docs/01-architecture.md) | API gateway là gì, request đi qua chuỗi middleware ra sao, Module / DI / middleware trong NestJS |
| 2 | [Routing](docs/02-routing.md) | Định tuyến theo prefix, prefix dài nhất thắng, service backend phải đặt path thế nào |
| 3 | [Xác thực (JWT, JWKS)](docs/03-authentication.md) | Cấu trúc JWT, RS256 vs HS256, JWKS và `kid`, issuer/audience, header định danh tin cậy |
| 4 | [Proxy](docs/04-proxying.md) | Reverse proxy, stream vs buffer body, header hop-by-hop, timeout, correlation ID |
| 5 | [Rate limiting](docs/05-rate-limiting.md) | Thuật toán fixed window, IP client khi đứng sau proxy, dọn bộ nhớ, giới hạn |
| 6 | [Cấu hình & triển khai](docs/06-configuration-and-deployment.md) | Biến môi trường và fail fast, Docker multi-stage build, CI/CD lên EC2 |

Nếu chỉ có 5 phút: xem sơ đồ vòng đời request ở trang 1 và checklist
"Thêm route mới" ở trang 2.
