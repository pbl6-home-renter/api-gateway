import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { HEALTH_PATH } from '../constants/route-paths.constants';
import { RequestPath } from '../common/request-path';

/** Liveness probe. Runs before rate limiting and auth, and is never proxied. */
@Injectable()
export class HealthMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    if (RequestPath.of(request) !== HEALTH_PATH) {
      next();
      return;
    }

    response.status(200).json({ status: 'ok', service: 'api-gateway' });
  }
}
