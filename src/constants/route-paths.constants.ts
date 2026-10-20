import { GatewayService } from './gateway-service.enum';

export const HEALTH_PATH = '/health';

/** Shared by the gateway and every backend service (`app.setGlobalPrefix('api/v1')`). */
export const API_PREFIX = '/api/v1';

export interface RouteDefinition {
  /** Path prefix, identical on the client side and in the backend service. */
  readonly prefix: string;
  readonly service: GatewayService;
}

/**
 * Client path prefix -> owning backend service. The path is forwarded
 * unchanged; service base URLs are resolved at runtime by
 * {@link RouteTableService} from {@link GatewayConfigService}.
 */
export const ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  { prefix: `${API_PREFIX}/auth`, service: GatewayService.Identity },
  { prefix: `${API_PREFIX}/users`, service: GatewayService.Identity },
  { prefix: `${API_PREFIX}/me`, service: GatewayService.Identity },
  { prefix: `${API_PREFIX}/.well-known`, service: GatewayService.Identity },
  { prefix: `${API_PREFIX}/payments`, service: GatewayService.Payment },
  { prefix: `${API_PREFIX}/chat`, service: GatewayService.Community },
  { prefix: `${API_PREFIX}/buildings`, service: GatewayService.Tenancy },
  { prefix: `${API_PREFIX}/rooms`, service: GatewayService.Tenancy },
  { prefix: `${API_PREFIX}/contracts`, service: GatewayService.Tenancy },
  { prefix: `${API_PREFIX}/invoices`, service: GatewayService.Tenancy },
];

/**
 * Paths that bypass JWT verification. Must stay in sync with
 * `ROUTE_DEFINITIONS` above: every public path must also resolve to a route,
 * or it will 404 instead of reaching the backend.
 */
export const PUBLIC_PATHS: readonly string[] = [
  HEALTH_PATH,
  `${API_PREFIX}/auth/register`,
  `${API_PREFIX}/auth/login`,
  `${API_PREFIX}/auth/password-reset-requests`,
  `${API_PREFIX}/auth/password-resets`,
  `${API_PREFIX}/.well-known/jwks.json`,
];
