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
token). Chúng được liệt kê trong `PUBLIC_PATHS` ở
[route-paths.constants.ts](../src/constants/route-paths.constants.ts):

```ts
HEALTH_PATH,
`${API_PREFIX}/auth/register`,
`${API_PREFIX}/auth/login`,
`${API_PREFIX}/auth/password-reset-requests`,
`${API_PREFIX}/auth/password-resets`,
`${API_PREFIX}/.well-known/jwks.json`,
```

So khớp theo từng đoạn path giống routing: `/api/v1/auth/login` cũng bao luôn
`/api/v1/auth/login/bat-ky-gi`.

Danh sách này là **allow-list**: mọi thứ không có trong danh sách đều cần
token. Đây là mặc định an toàn. Quên khai báo một endpoint chỉ khiến nó *quá
chặt* (lỗi `401` thấy ngay), không bao giờ khiến nó *bị hở*.

Path public vẫn phải khớp một route trong `ROUTE_DEFINITIONS`, nếu không sẽ trả `404`.

## Header định danh tin cậy

Sau khi verify, bước proxy gửi kèm thông tin người gọi:

| Header | Lấy từ |
|---|---|
| `x-user-id` | claim `sub` |
| `x-user-role` | claim `role` |

Service backend đọc các header này **thay vì tự verify JWT lần nữa**. Điều đó
chỉ an toàn nhờ hai bảo đảm:

1. **Gateway xoá bản do client tự gửi.** Ai gửi `x-user-id: nguoi-khac` sẽ bị
   gỡ header đó trước khi chuyển tiếp (`SPOOFABLE_HEADERS` trong
   [headers.constants.ts](../src/constants/headers.constants.ts)). Trên path
   public, nơi không có token để verify, backend không nhận được `x-user-id` nào cả.
2. **Backend chỉ truy cập được qua gateway.** Nếu port của service bị mở ra
   Internet, kẻ tấn công có thể gọi thẳng vào với header giả. Chỉ dùng `expose`.

### Service backend nên làm gì

```ts
// một param decorator trong service
export const CurrentUser = createParamDecorator((_, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request>();
  return { id: request.header('x-user-id'), role: request.header('x-user-role') };
});
```

Sau đó thêm guard để kiểm tra role (`@Roles('landlord')`), và kiểm tra quyền
sở hữu dữ liệu trong tầng service, nơi có dữ liệu.

## Các trường hợp lỗi

| Tình huống | Response |
|---|---|
| Không có header `Authorization`, hoặc không theo dạng `Bearer ...` | `401 UNAUTHORIZED` |
| Token hết hạn, bị sửa, sai `iss`/`aud`, `kid` lạ | `401 UNAUTHORIZED` |
| Chưa đặt `JWKS_URL` | `503 JWKS_NOT_CONFIGURED` cho mọi path cần bảo vệ |
| Identity sập đúng lúc gateway cần tải key | `401 UNAUTHORIZED` (verify thất bại); path public vẫn chạy |
