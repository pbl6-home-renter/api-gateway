import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey, type JWTPayload } from 'jose';
import { GatewayConfigService } from '../config/gateway-config.service';
import { RouteTableService } from '../routing/route-table.service';
import { RequestPath } from '../common/request-path';

export type UserClaims = JWTPayload & { role?: string };

export interface AuthenticatedRequest extends Request {
  userClaims?: UserClaims;
}

/**
 * Verifies the Bearer access token against the Identity Service JWKS for
 * any path not listed in `PUBLIC_PATHS`. On success, attaches the decoded
 * claims to `request.userClaims` for downstream middleware to forward as
 * `x-user-id` / `x-user-role` headers.
 */
@Injectable()
export class JwtAuthMiddleware implements NestMiddleware {
  private readonly jwks: JWTVerifyGetKey | undefined;

  constructor(
    private readonly config: GatewayConfigService,
    private readonly routeTable: RouteTableService,
  ) {
    this.jwks = config.jwksUrl ? createRemoteJWKSet(new URL(config.jwksUrl)) : undefined;
  }

  async use(request: AuthenticatedRequest, response: Response, next: NextFunction): Promise<void> {
    if (this.routeTable.isPublicPath(RequestPath.of(request))) {
      next();
      return;
    }

    if (!this.jwks) {
      response.status(503).json({ statusCode: 503, code: 'JWKS_NOT_CONFIGURED' });
      return;
    }

    const authorization = request.header('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      response.status(401).json({ statusCode: 401, code: 'UNAUTHORIZED' });
      return;
    }

    try {
      const verified = await jwtVerify(authorization.slice('Bearer '.length), this.jwks, {
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
        algorithms: ['RS256'],
      });

      request.userClaims = verified.payload as UserClaims;

      next();
    } catch {
      response.status(401).json({ statusCode: 401, code: 'UNAUTHORIZED' });
    }
  }
}
