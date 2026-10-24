import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey, type JWTPayload } from 'jose';
import { GatewayConfigService } from '../config/gateway-config.service';
import { RouteTableService } from '../routing/route-table.service';
import { RequestPath } from '../common/request-path';

export type UserClaims = JWTPayload & { sub: string; role: string; status: string };

export interface AuthenticatedRequest extends Request {
  userClaims?: UserClaims;
}

const INVALID_TOKEN_ERROR_CODES = new Set([
  'ERR_JWT_EXPIRED',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWT_INVALID',
  'ERR_JWS_INVALID',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JOSE_NOT_SUPPORTED',
]);

const JWKS_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const CLOCK_TOLERANCE_SECONDS = 5;

type VerifyOutcome =
  | { kind: 'valid'; claims: UserClaims }
  | { kind: 'invalid' }
  | { kind: 'unavailable' };

/**
 * Edge authentication. Rejects requests without a valid Bearer access token
 * (verified against the Identity Service JWKS) unless they match
 * `PUBLIC_RULES`; on public routes a valid token is still decoded. Backend
 * services verify the forwarded token again: this layer filters traffic, it
 * is not the final authority.
 */
@Injectable()
export class JwtAuthMiddleware implements NestMiddleware {
  private readonly logger = new Logger(JwtAuthMiddleware.name);
  private readonly jwks: JWTVerifyGetKey | undefined;

  constructor(
    private readonly config: GatewayConfigService,
    private readonly routeTable: RouteTableService,
  ) {
    this.jwks = config.jwksUrl
      ? createRemoteJWKSet(new URL(config.jwksUrl), { cacheMaxAge: JWKS_CACHE_MAX_AGE_MS })
      : undefined;
  }

  async use(request: AuthenticatedRequest, response: Response, next: NextFunction): Promise<void> {
    const isPublic = this.routeTable.isPublic(request.method, RequestPath.of(request));
    const authorization = request.header('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined;

    if (!token) {
      if (isPublic) {
        next();
        return;
      }
      response.status(401).json({ statusCode: 401, code: 'UNAUTHORIZED' });
      return;
    }

    const outcome = await this.verify(token);
    if (outcome.kind === 'valid') {
      request.userClaims = outcome.claims;
      next();
      return;
    }
    // A bad token on a public route is treated as anonymous; the service decides.
    if (isPublic) {
      next();
      return;
    }
    if (outcome.kind === 'invalid') {
      response.status(401).json({ statusCode: 401, code: 'UNAUTHORIZED' });
      return;
    }
    // Not 401: the client's token may be fine, so it must not log the user out.
    response.status(503).json({ statusCode: 503, code: 'AUTH_UNAVAILABLE' });
  }

  private async verify(token: string): Promise<VerifyOutcome> {
    if (!this.jwks) return { kind: 'unavailable' };

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
        algorithms: ['RS256'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
      const { sub, role, status } = payload as Partial<UserClaims>;
      if (!sub || typeof role !== 'string' || typeof status !== 'string') {
        return { kind: 'invalid' };
      }
      return { kind: 'valid', claims: payload as UserClaims };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code && INVALID_TOKEN_ERROR_CODES.has(code)) return { kind: 'invalid' };
      this.logger.error(`Cannot load JWKS from ${this.config.jwksUrl}: ${String(error)}`);
      return { kind: 'unavailable' };
    }
  }
}
