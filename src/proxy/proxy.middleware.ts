import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware, type Options, type RequestHandler } from 'http-proxy-middleware';
import { GatewayConfigService } from '../config/gateway-config.service';
import {
  CORRELATION_ID_HEADER,
  HOP_BY_HOP_HEADERS,
  SPOOFABLE_HEADER_PREFIXES,
  UPSTREAM_CORS_HEADER_PREFIX,
} from '../constants/headers.constants';
import type { RoutedRequest } from '../routing/route-resolver.middleware';
import type { AuthenticatedRequest } from '../auth/jwt-auth.middleware';
import type { CorrelatedRequest } from '../common/correlation-id';

type GatewayRequest = RoutedRequest & AuthenticatedRequest & CorrelatedRequest;

/**
 * Streams the request unchanged to the backend resolved upstream. The
 * `Authorization` header is forwarded as-is so each service verifies the
 * token itself; `x-user-id` is added for log correlation only.
 */
@Injectable()
export class ProxyMiddleware implements NestMiddleware {
  private readonly handler: RequestHandler<GatewayRequest, Response>;

  constructor(private readonly config: GatewayConfigService) {
    const options: Options<GatewayRequest, Response> = {
      changeOrigin: true,
      xfwd: true,
      timeout: this.config.proxyTimeoutMs,
      proxyTimeout: this.config.proxyTimeoutMs,
      router: (request) => request.gatewayRoute!.baseUrl!,
      // Nest strips the mount path from `request.url`; forward the original path + query.
      pathRewrite: (_path, request) => request.originalUrl,
      on: {
        proxyReq: (proxyReq, request) => this.onProxyReq(proxyReq, request),
        proxyRes: (proxyRes) => this.onProxyRes(proxyRes),
        error: (err, _request, res) => this.onError(err, res),
      },
    };
    this.handler = createProxyMiddleware<GatewayRequest, Response>(options);
  }

  use(request: Request, response: Response, next: NextFunction): void {
    void this.handler(request as GatewayRequest, response, next);
  }

  private onProxyReq(proxyReq: ClientRequest, request: GatewayRequest): void {
    for (const header of proxyReq.getHeaderNames()) {
      if (SPOOFABLE_HEADER_PREFIXES.some((prefix) => header.startsWith(prefix))) proxyReq.removeHeader(header);
    }
    for (const header of HOP_BY_HOP_HEADERS) proxyReq.removeHeader(header);

    proxyReq.setHeader(CORRELATION_ID_HEADER, request.correlationId);

    const claims = request.userClaims;
    if (claims) proxyReq.setHeader('x-user-id', claims.sub);
  }

  private onProxyRes(proxyRes: IncomingMessage): void {
    for (const header of Object.keys(proxyRes.headers)) {
      if (header.startsWith(UPSTREAM_CORS_HEADER_PREFIX)) delete proxyRes.headers[header];
    }
    delete proxyRes.headers[CORRELATION_ID_HEADER];
  }

  private onError(err: Error, res: Response | Socket): void {
    // `res` is a raw socket instead of an HTTP response during a failed
    // WebSocket upgrade; the gateway does not proxy upgrades, but guard anyway.
    if (!('headersSent' in res)) {
      res.destroy();
      return;
    }

    if (res.headersSent)
      return;

    const code = err.message.includes('ECONNREFUSED') ? 503 : 504;

    res.status(code).json({ statusCode: code, code: code === 504 ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE' });
  }
}
