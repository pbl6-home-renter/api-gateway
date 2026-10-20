import type { Request } from 'express';

/**
 * Full request pathname, without the query string.
 *
 * Nest mounts `forRoutes('*')` middleware on an Express wildcard, which strips
 * the matched segment from `request.path` / `request.url` (they become `/`).
 * `originalUrl` is never rewritten, so it is the reliable source.
 */
export class RequestPath {
  static of(request: Request): string {
    const queryStart = request.originalUrl.indexOf('?');
    return queryStart === -1 ? request.originalUrl : request.originalUrl.slice(0, queryStart);
  }
}
