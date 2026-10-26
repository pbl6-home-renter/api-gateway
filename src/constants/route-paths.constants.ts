import { GatewayService } from './gateway-service.enum';

export const HEALTH_PATH = '/health';

/** Shared by the gateway and every backend service (`app.setGlobalPrefix('api/v1')`). */
export const API_PREFIX = '/api/v1';

export interface RouteDefinition {
  /** Path prefix, identical on the client side and in the backend service. */
  readonly prefix: string;
  readonly service: GatewayService;
}

/** Path segment each service serves its health check and Swagger under. */
const SERVICE_PATHS: Readonly<Record<GatewayService, string>> = {
  [GatewayService.Identity]: 'identity',
  [GatewayService.Tenancy]: 'tenancy',
  [GatewayService.Payment]: 'payment',
  [GatewayService.Community]: 'community',
};

const ROUTE_PREFIXES: Readonly<Record<GatewayService, readonly string[]>> = {
  [GatewayService.Identity]: [
    '/auth',
    '/users',
    '/me', // `/me`, `/me/password`, `/me/push-devices`; other `/me/*` are listed below
    '/media',
    '/audit-logs',
    '/.well-known',
  ],
  [GatewayService.Tenancy]: [
    '/buildings',
    '/admin/buildings',
    '/rooms',
    '/rate-policies',
    '/billing-settings',
    '/contract-templates',
    '/contracts',
    '/contract-members',
    '/meter-readings',
    '/invoices',
    '/roommate-profiles',
    '/match-requests',
    '/dashboard',
    '/me/buildings',
    '/me/rooms',
    '/me/room-hub',
    '/me/favorite-rooms',
    '/me/roommate-profile',
    '/me/contracts',
    '/administrative-units',
  ],
  [GatewayService.Payment]: ['/payments', '/me/payments'],
  [GatewayService.Community]: [
    '/conversations',
    '/messages',
    '/issues',
    '/notifications',
    '/me/issues',
    '/me/notification-preference',
  ],
};

/**
 * Client path prefix -> owning backend service, mirroring `api-docs`. The
 * most specific prefix wins (`/me/buildings` beats `/me`). The path is
 * forwarded unchanged; service base URLs are resolved at runtime by
 * {@link RouteTableService} from {@link GatewayConfigService}.
 *
 * Anything not listed (including `internal/*` service-to-service endpoints)
 * answers 404 and never reaches a backend.
 */
export const ROUTE_DEFINITIONS: readonly RouteDefinition[] = (
  Object.keys(ROUTE_PREFIXES) as GatewayService[]
).flatMap((service) =>
  [...ROUTE_PREFIXES[service], `/${SERVICE_PATHS[service]}`].map((prefix) => ({
    prefix: `${API_PREFIX}${prefix}`,
    service,
  })),
);

export interface PublicRule {
  /** HTTP method, or `*` for any. */
  readonly method: string;
  /** `*` matches one path segment; a trailing `**` matches the rest. Otherwise exact. */
  readonly path: string;
}

/**
 * Requests that bypass the gateway's token check (a valid token, if sent, is
 * still verified and forwarded). This is an edge filter only: every service
 * verifies the token again and has the final say.
 */
export const PUBLIC_RULES: readonly PublicRule[] = [
  { method: '*', path: HEALTH_PATH },
  { method: 'POST', path: `${API_PREFIX}/auth/register` },
  { method: 'POST', path: `${API_PREFIX}/auth/login` },
  { method: 'POST', path: `${API_PREFIX}/auth/refresh` },
  { method: 'POST', path: `${API_PREFIX}/auth/password-reset-requests` },
  { method: 'POST', path: `${API_PREFIX}/auth/password-resets` },
  { method: 'GET', path: `${API_PREFIX}/.well-known/jwks.json` },
  // Guest browsing (shared_user_flow §1.5)
  { method: 'GET', path: `${API_PREFIX}/buildings` },
  { method: 'GET', path: `${API_PREFIX}/buildings/*` },
  { method: 'GET', path: `${API_PREFIX}/rooms` },
  { method: 'GET', path: `${API_PREFIX}/rooms/*` },
  { method: 'GET', path: `${API_PREFIX}/administrative-units/provinces` },
  { method: 'GET', path: `${API_PREFIX}/administrative-units/provinces/*/wards` },
  // Payment provider callbacks, authenticated by signature in payment-service
  { method: 'POST', path: `${API_PREFIX}/payments/webhooks/*` },
  ...Object.values(SERVICE_PATHS).flatMap((servicePath) => [
    { method: 'GET', path: `${API_PREFIX}/${servicePath}/health` },
    { method: 'GET', path: `${API_PREFIX}/${servicePath}/swagger/**` },
  ]),
];
