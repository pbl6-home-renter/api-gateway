/** Backend services the gateway can route to. */
export enum GatewayService {
  Identity = 'IDENTITY',
  Tenancy = 'TENANCY',
  Payment = 'PAYMENT',
  Community = 'COMMUNITY',
}

/** Env var holding each service's base URL (e.g. `http://identity:3001`). */
export const SERVICE_URL_ENV_VAR: Readonly<Record<GatewayService, string>> = {
  [GatewayService.Identity]: 'IDENTITY_SERVICE_URL',
  [GatewayService.Tenancy]: 'TENANCY_SERVICE_URL',
  [GatewayService.Payment]: 'PAYMENT_SERVICE_URL',
  [GatewayService.Community]: 'COMMUNITY_SERVICE_URL',
};
