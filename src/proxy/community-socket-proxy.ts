import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { GatewayConfigService } from '../config/gateway-config.service';
import { GatewayService } from '../constants/gateway-service.enum';
import { SPOOFABLE_HEADER_PREFIXES } from '../constants/headers.constants';

const SOCKET_PATH = '/api/v1/community/socket.io';

/** Upgrade requests bypass Nest HTTP middleware; Community verifies the JWT. */
export function registerCommunitySocketProxy(
  server: {
    on(
      event: 'upgrade',
      listener: (
        request: IncomingMessage,
        socket: Socket,
        head: Buffer,
      ) => void,
    ): unknown;
  },
  config: GatewayConfigService,
): void {
  const target = config.getServiceUrl(GatewayService.Community);
  const proxy = target
    ? createProxyMiddleware({
        target,
        changeOrigin: true,
        ws: true,
        on: {
          proxyReqWs: (proxyRequest) => {
            for (const name of proxyRequest.getHeaderNames()) {
              if (
                SPOOFABLE_HEADER_PREFIXES.some((prefix) =>
                  name.startsWith(prefix),
                )
              ) {
                proxyRequest.removeHeader(name);
              }
            }
          },
          error: (_error, _request, response) => {
            if ('destroy' in response) response.destroy();
          },
        },
      })
    : null;

  server.on('upgrade', (request, socket, head) => {
    let path: string;
    try {
      path = new URL(request.url ?? '', 'http://gateway').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (path !== SOCKET_PATH) {
      socket.destroy();
      return;
    }
    const origin = request.headers.origin;
    if (origin && !config.corsOrigins.includes(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!proxy) {
      socket.write(
        'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n',
      );
      socket.destroy();
      return;
    }
    proxy.upgrade(request, socket, head);
  });
}
