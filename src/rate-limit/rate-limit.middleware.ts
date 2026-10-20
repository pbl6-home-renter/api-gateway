import { Injectable, type NestMiddleware, type OnModuleDestroy } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { GatewayConfigService } from '../config/gateway-config.service';
import { RequestPath } from '../common/request-path';

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
    const isAuthEndpoint = RequestPath.of(request).includes('/auth/');
    const limit = isAuthEndpoint ? this.config.authRateLimit : this.config.defaultRateLimit;
    const bucketKey = `${request.ip}:${isAuthEndpoint ? 'auth' : 'api'}`;
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
