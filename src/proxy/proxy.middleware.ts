import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware, type Options, type RequestHandler } from 'http-proxy-middleware';
import { GatewayConfigService } from '../config/gateway-config.service';
import { HOP_BY_HOP_HEADERS, SPOOFABLE_HEADERS } from '../constants/headers.constants';
import type { RoutedRequest } from '../routing/route-resolver.middleware';
import type { AuthenticatedRequest } from '../auth/jwt-auth.middleware';
import { CorrelationId } from '../common/correlation-id';

type GatewayRequest = RoutedRequest & AuthenticatedRequest;

/** Streams the request unchanged to the backend resolved upstream, injecting trusted headers. */
@Injectable()
export class ProxyMiddleware implements NestMiddleware {
  private readonly handler: RequestHandler<GatewayRequest, Response>;

  constructor(private readonly config: GatewayConfigService) {
    const options: Options<GatewayRequest, Response> = {
      changeOrigin: true,
      timeout: this.config.proxyTimeoutMs,
      proxyTimeout: this.config.proxyTimeoutMs,
      router: (request) => request.gatewayRoute!.baseUrl!,
      // Nest strips the mount path from `request.url`; forward the original path + query.
      pathRewrite: (_path, request) => request.originalUrl,
      on: {
        proxyReq: (proxyReq, request) => this.onProxyReq(proxyReq, request),
        error: (err, _request, res) => this.onError(err, res),
      },
    };
    this.handler = createProxyMiddleware<GatewayRequest, Response>(options);
  }

  use(request: Request, response: Response, next: NextFunction): void {
    void this.handler(request as GatewayRequest, response, next);
  }

  private onProxyReq(proxyReq: import('node:http').ClientRequest, request: GatewayRequest): void {
    for (const header of SPOOFABLE_HEADERS) proxyReq.removeHeader(header);
    for (const header of HOP_BY_HOP_HEADERS) proxyReq.removeHeader(header);

    proxyReq.setHeader('x-correlation-id', CorrelationId.resolve(request));

    const claims = request.userClaims;

    if (claims?.sub)
      proxyReq.setHeader('x-user-id', String(claims.sub));

    if (claims?.role)
      proxyReq.setHeader('x-user-role', claims.role);
  }

  private onError(err: Error, res: Response | import('node:net').Socket): void {
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
