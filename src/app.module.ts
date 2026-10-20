import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { GatewayConfigService } from './config/gateway-config.service';
import { RouteTableService } from './routing/route-table.service';
import { HealthMiddleware } from './health/health.middleware';
import { RateLimitMiddleware } from './rate-limit/rate-limit.middleware';
import { RouteResolverMiddleware } from './routing/route-resolver.middleware';
import { JwtAuthMiddleware } from './auth/jwt-auth.middleware';
import { ProxyMiddleware } from './proxy/proxy.middleware';

@Module({
  providers: [
    GatewayConfigService,
    RouteTableService,
    HealthMiddleware,
    RateLimitMiddleware,
    RouteResolverMiddleware,
    JwtAuthMiddleware,
    ProxyMiddleware,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(HealthMiddleware, RateLimitMiddleware, RouteResolverMiddleware, JwtAuthMiddleware, ProxyMiddleware)
      .forRoutes('*');
  }
}
