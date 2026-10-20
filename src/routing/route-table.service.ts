import { Injectable } from '@nestjs/common';
import { GatewayConfigService } from '../config/gateway-config.service';
import { PUBLIC_PATHS, ROUTE_DEFINITIONS } from '../constants/route-paths.constants';

export interface RouteEntry {
  prefix: string;
  baseUrl: string | undefined;
}

/** Resolves client paths to backend routes using `ROUTE_DEFINITIONS` + configured service URLs. */
@Injectable()
export class RouteTableService {
  private readonly routes: readonly RouteEntry[];

  constructor(private readonly config: GatewayConfigService) {
    this.routes = ROUTE_DEFINITIONS.map((definition) => ({
      prefix: definition.prefix,
      baseUrl: config.getServiceUrl(definition.service),
    }));
  }

  isPublicPath(path: string): boolean {
    return PUBLIC_PATHS.some((prefix) => this.matchesPrefix(path, prefix));
  }

  /** Finds the most specific matching route (longest prefix wins). */
  resolve(path: string): RouteEntry | undefined {
    return this.routes
      .filter((route) => this.matchesPrefix(path, route.prefix))
      .sort((left, right) => right.prefix.length - left.prefix.length)[0];
  }

  private matchesPrefix(path: string, prefix: string): boolean {
    return path === prefix || path.startsWith(`${prefix}/`);
  }
}
