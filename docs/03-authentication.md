# 3. Xác thực (JWT, RS256, JWKS)

## Khái niệm: token không trạng thái (stateless)

Sau khi login, Identity trả cho client một **access token**. Client gửi kèm
token này trong mọi request:

```
Authorization: Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6InJlbnRpZnktaWRlbnRpdHktMjAyNi0wMSJ9.eyJzdWIiOi...
```

Gateway kiểm tra token **mà không cần gọi Identity hay database**. Làm được
vậy vì token là một **JWT** (JSON Web Token): một "lời khẳng định" có chữ ký
mà chỉ Identity tạo được, còn ai có public key cũng kiểm tra được.

### Cấu tạo của một JWT

Ba phần mã hoá base64url, ngăn cách bởi dấu chấm: `header.payload.signature`.

```jsonc
// header
{ "alg": "RS256", "kid": "rentify-identity-2026-01" }

// payload ("claims")
{
  "sub": "u_9",                 // subject: id người dùng
  "role": "landlord",           // claim tuỳ chỉnh
  "iss": "rentify-identity",    // issuer: ai ký token
  "aud": "rentify-api",         // audience: token dành cho ai
  "iat": 1792500000,            // thời điểm phát hành
  "exp": 1792500900             // thời điểm hết hạn (15 phút sau)
}
```

**Chữ ký** được tính trên header + payload. Chỉ cần sửa một ký tự trong
payload (ví dụ `"role": "admin"`), chữ ký sẽ không còn khớp và token bị từ chối.

> Payload chỉ được **mã hoá base64**, không được **mã hoá bí mật**. Ai cũng
> đọc được (thử dán vào jwt.io). Không bao giờ để thông tin bí mật trong claim.

### RS256 và HS256

| | HS256 (đối xứng) | RS256 (bất đối xứng) — đang dùng |
|---|---|---|
| Khoá | Một secret dùng chung để ký **và** kiểm tra | Private key để ký; public key để kiểm tra |
| Ai tạo được token | Bất kỳ ai giữ secret | Chỉ Identity (giữ private key) |
| Gateway giữ gì | Secret (lộ là kẻ tấn công tự tạo token được) | Chỉ public key (công khai cũng không sao) |

Với RS256, kể cả gateway bị chiếm quyền thì cũng không làm giả token được.
Chỉ Identity mới tạo được.

### JWKS: phân phối public key

Gateway lấy public key của Identity bằng cách nào? Identity công bố nó tại
endpoint **JWKS** (JSON Web Key Set):

```
GET http://identity:3001/api/v1/.well-known/jwks.json
{ "keys": [ { "kty": "RSA", "kid": "rentify-identity-2026-01", "n": "...", "e": "AQAB", "alg": "RS256", "use": "sig" } ] }
```

Mỗi key có một **`kid`** (key id). Header của token ghi rõ `kid` đã dùng để ký,
bên kiểm tra sẽ chọn đúng key đó. Đây là thứ cho phép **xoay key (key
rotation)**: Identity công bố cả key cũ lẫn key mới, bắt đầu ký bằng `kid` mới,
rồi gỡ key cũ khi các token cũ đã hết hạn. Gateway không cần sửa gì, không cần restart.

## Gateway kiểm tra token thế nào

[auth/jwt-auth.middleware.ts](../src/auth/jwt-auth.middleware.ts), dùng thư viện
[`jose`](https://github.com/panva/jose):

```ts
this.jwks = createRemoteJWKSet(new URL(config.jwksUrl));   // một lần, lúc khởi động

await jwtVerify(token, this.jwks, {
  issuer: this.config.jwtIssuer,       // iss phải bằng JWT_ISSUER
  audience: this.config.jwtAudience,   // aud phải bằng JWT_AUDIENCE
  algorithms: ['RS256'],               // từ chối mọi alg khác
});
```

Về cơ bản `jwtVerify` kiểm tra:

1. `alg` trong header nằm trong danh sách cho phép. Cố định `RS256` chặn được
   các kiểu tấn công kinh điển "`alg: none`" và "đánh tráo RS256 → HS256".
2. Chữ ký khớp với key trong JWKS có `kid` tương ứng.
3. `exp` còn ở tương lai (và `nbf`, nếu có, đã qua).
4. `iss` và `aud` khớp.

Sai bất kỳ điều nào → `401 UNAUTHORIZED`. Gateway cố ý không nói *điều nào*
sai, để kẻ tấn công không dò được gì.

`createRemoteJWKSet` **cache** bộ key trong bộ nhớ. Nó tải key ở lần dùng đầu
tiên và tải lại khi gặp `kid` lạ (có khoảng chờ ngắn để tránh gọi dồn dập).
Vì vậy bình thường việc verify không tốn lời gọi mạng nào.

### Vì sao phải kiểm tra `iss` và `aud`?

- **Issuer** chứng minh token do *chính* Identity của mình phát hành.
- **Audience** chứng minh token được cấp cho *API này*. Nếu sau này Identity
  phát hành token cho hệ thống khác (ví dụ công cụ admin với audience
  `rentify-admin`), những token đó sẽ không dùng được ở đây.

`JWT_ISSUER` / `JWT_AUDIENCE` **phải giống hệt nhau** trong `env/identity.env`
(dùng khi ký) và `env/api-gateway.env` (dùng khi kiểm tra). Lệch nhau là mọi
token đều bị `401`.

## Path public

Một số endpoint phải gọi được khi chưa có token (đang login thì làm gì đã có
token; khách xem phòng). Chúng được liệt kê trong `PUBLIC_RULES` ở
[route-paths.constants.ts](../src/constants/route-paths.constants.ts), mỗi rule
gồm **method** và **path**:

```ts
{ method: 'POST', path: `${API_PREFIX}/auth/login` },
{ method: 'POST', path: `${API_PREFIX}/auth/refresh` },
{ method: 'GET',  path: `${API_PREFIX}/rooms` },
{ method: 'GET',  path: `${API_PREFIX}/rooms/*` },          // * = đúng một đoạn path
{ method: 'POST', path: `${API_PREFIX}/payments/webhooks/*` },
{ method: 'GET',  path: `${API_PREFIX}/identity/swagger/**` }, // ** = phần còn lại
```

So khớp **chính xác** theo method và từng đoạn path: `GET /rooms/42` là public,
nhưng `POST /rooms`, `PATCH /rooms/42` hay `POST /rooms/42/mark-ready` vẫn cần token.

Danh sách này là **allow-list**: mọi thứ không có trong danh sách đều cần
token. Quên khai báo một endpoint chỉ khiến nó *quá chặt* (lỗi `401` thấy ngay),
không bao giờ khiến nó *bị hở*. Path public vẫn phải khớp một route trong
`ROUTE_DEFINITIONS`, nếu không sẽ trả `404`.

**Optional auth:** trên path public, nếu client có gửi Bearer token hợp lệ thì
gateway vẫn verify và chuyển tiếp như bình thường (vd. khách đã đăng nhập xem
phòng để biết phòng nào đã lưu yêu thích). Token sai trên path public bị bỏ qua,
service tự quyết định.

## Hai lớp xác thực: gateway và service

**Mọi service tự verify lại access token** (header `Authorization` được gateway
chuyển tiếp nguyên vẹn), bằng JWKS cache cục bộ giống hệt gateway. Service
**không** dùng header `x-user-*` để phân quyền.

Vì sao? Mô hình "service tin header của gateway" chỉ an toàn khi *chỉ duy nhất
gateway gọi được service*. Khi hệ thống chạy trên nhiều server trong cùng
private network, port của service phải mở cho cả mạng đó: bất kỳ máy/container
nào trong mạng (bị chiếm quyền, script debug, service khác dính lỗi SSRF) gửi
`x-user-id: <id-admin>` là thành admin. Header chỉ là **lời khai**; JWT là
**bằng chứng có chữ ký** mà chỉ Identity tạo được. Verify cục bộ gần như không
tốn gì (không có network hop), nên không có lý do bỏ qua.

Vậy gateway xác thực để làm gì? Hai lớp làm hai việc khác nhau:

| Gateway (lọc ở cửa) | Service (quyết định cuối) |
|---|---|
| Chặn sớm request không token, service không tốn CPU/DB cho chúng | Token có hợp lệ không |
| Một chỗ định nghĩa public/protected, một mã `401` thống nhất để client refresh token | Phân quyền: `@Roles`, `status=locked`, ownership dữ liệu |
| Rate limit, log có user id, correlation id | Không phụ thuộc topology mạng |
| Không bao giờ route `internal/*` ra Internet | |

Chi tiết guard phía service: xem mục *Xác thực* trong README của `boilerplate`.

### Header gateway thêm vào

| Header | Mục đích |
|---|---|
| `Authorization` | Chuyển tiếp nguyên vẹn, service verify lại |
| `x-user-id` | Claim `sub`, **chỉ để log/trace** |
| `x-correlation-id` | Truy vết request qua các service |

Mọi header `x-user-*` và `x-service-token` do client tự gửi đều bị xoá trước
khi chuyển tiếp (`SPOOFABLE_HEADER_PREFIXES` trong
[headers.constants.ts](../src/constants/headers.constants.ts)).

Claim bắt buộc trong access token: `sub`, `role`, `status`. Thiếu một trong ba → `401`.

## Các trường hợp lỗi

| Tình huống | Response |
|---|---|
| Path cần token mà không có header `Authorization`, hoặc không theo dạng `Bearer ...` | `401 UNAUTHORIZED` |
| Token hết hạn, bị sửa, sai `iss`/`aud`, `kid` lạ, thiếu claim | `401 UNAUTHORIZED` |
| Không tải được JWKS (Identity sập, chưa đặt `JWKS_URL`) | `503 AUTH_UNAVAILABLE`; path public vẫn chạy |

`503 AUTH_UNAVAILABLE` cố ý **khác** `401`: token của client có thể vẫn còn tốt,
nên client không được logout hay refresh khi gặp mã này, chỉ cần thử lại sau.
