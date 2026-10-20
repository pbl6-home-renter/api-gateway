/** Client-supplied headers we must never forward as-is: they would let a caller impersonate another user. */
export const SPOOFABLE_HEADERS: readonly string[] = ['x-user-id', 'x-user-role'];

/** Hop-by-hop headers must not be forwarded by a proxy (RFC 7230 §6.1). */
export const HOP_BY_HOP_HEADERS: readonly string[] = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];
