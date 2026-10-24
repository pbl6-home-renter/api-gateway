import { Injectable } from '@nestjs/common';
import { GatewayService, SERVICE_URL_ENV_VAR } from '../constants/gateway-service.enum';

/** Reads and validates all gateway env vars once at startup. */
@Injectable()
export class GatewayConfigService {
  readonly port: number;
  readonly jwksUrl: string | undefined;
  readonly jwtIssuer: string;
  readonly jwtAudience: string;
  readonly proxyTimeoutMs: number;
  readonly rateLimitWindowMs: number;
  readonly defaultRateLimit: number;
  readonly authRateLimit: number;
  readonly refreshRateLimit: number;
  readonly corsOrigins: readonly string[];

  private readonly serviceUrls: Readonly<Record<GatewayService, string | undefined>>;

  constructor() {
    this.port = this.readInt('PORT', 3000);
    this.jwksUrl = process.env.JWKS_URL;
    this.jwtIssuer = process.env.JWT_ISSUER ?? 'rentify-identity';
    this.jwtAudience = process.env.JWT_AUDIENCE ?? 'rentify-api';
    this.proxyTimeoutMs = this.readInt('PROXY_TIMEOUT_MS', 10000);
    this.rateLimitWindowMs = this.readInt('RATE_LIMIT_WINDOW_MS', 60000);
    this.defaultRateLimit = this.readInt('RATE_LIMIT_MAX', 120);
    this.authRateLimit = this.readInt('AUTH_RATE_LIMIT_MAX', 10);
    this.refreshRateLimit = this.readInt('REFRESH_RATE_LIMIT_MAX', 60);
    this.corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    this.serviceUrls = Object.fromEntries(
      Object.entries(SERVICE_URL_ENV_VAR).map(([service, envVar]) => [service, process.env[envVar]]),
    ) as Record<GatewayService, string | undefined>;
  }

  getServiceUrl(service: GatewayService): string | undefined {
    return this.serviceUrls[service];
  }

  private readInt(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid ${name}: expected a positive number, got "${raw}"`);
    }
    return value;
  }
}
