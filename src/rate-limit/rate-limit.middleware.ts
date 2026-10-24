import { Injectable, type NestMiddleware, type OnModuleDestroy } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { GatewayConfigService } from '../config/gateway-config.service';
import { RequestPath } from '../common/request-path';
import { API_PREFIX } from '../constants/route-paths.constants';

type RouteClass = 'auth' | 'refresh' | 'api';

const AUTH_PREFIX = `${API_PREFIX}/auth/`;
const REFRESH_PATH = `${API_PREFIX}/auth/refresh`;

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Simple fixed-window rate limiter keyed by client IP + route class.
 * Suitable for a single-instance gateway; does not share state across
 * replicas. Expired buckets are swept periodically so the map does not
 * grow without bound.
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware, OnModuleDestroy {
  private readonly buckets = new Map<string, Bucket>();
  private readonly sweepInterval: NodeJS.Timeout;

  constructor(private readonly config: GatewayConfigService) {
    this.sweepInterval = setInterval(() => this.sweepExpiredBuckets(), config.rateLimitWindowMs);
    this.sweepInterval.unref();
  }

  use(request: Request, response: Response, next: NextFunction): void {
    const routeClass = this.classify(RequestPath.of(request));
    const limit = this.limitFor(routeClass);
    const bucketKey = `${request.ip}:${routeClass}`;
    const now = Date.now();

    const bucket = this.buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(bucketKey, { count: 1, resetAt: now + this.config.rateLimitWindowMs });
      next();
      return;
    }

    if (bucket.count >= limit) {
      response.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
      response.status(429).json({ statusCode: 429, code: 'RATE_LIMITED' });
      return;
    }

    bucket.count += 1;
    next();
  }

  /**
   * Login/register/password-reset get the strict limit (brute force). Refresh
   * is separate and looser: a whole class behind one NAT refreshes every 15
   * minutes, which must not lock everyone out of logging in.
   */
  private classify(path: string): RouteClass {
    if (path === REFRESH_PATH) return 'refresh';
    return path.startsWith(AUTH_PREFIX) ? 'auth' : 'api';
  }

  private limitFor(routeClass: RouteClass): number {
    switch (routeClass) {
      case 'auth':
        return this.config.authRateLimit;
      case 'refresh':
        return this.config.refreshRateLimit;
      default:
        return this.config.defaultRateLimit;
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepInterval);
  }

  private sweepExpiredBuckets(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
