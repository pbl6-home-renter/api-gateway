/**
 * Client-supplied headers we must never forward as-is. Services do not trust
 * them for authorization, but stripping keeps logs honest and stops a caller
 * from presenting itself as another service.
 */
export const SPOOFABLE_HEADER_PREFIXES: readonly string[] = ['x-user-', 'x-service-token'];

/** CORS is answered by the gateway alone; upstream values would override (and conflict with) it. */
export const UPSTREAM_CORS_HEADER_PREFIX = 'access-control-';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

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
