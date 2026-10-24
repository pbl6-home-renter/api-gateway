import { Injectable } from '@nestjs/common';
import { GatewayConfigService } from '../config/gateway-config.service';
import { PUBLIC_RULES, ROUTE_DEFINITIONS, type PublicRule } from '../constants/route-paths.constants';

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

  isPublic(method: string, path: string): boolean {
    return PUBLIC_RULES.some((rule) => this.matchesRule(rule, method, path));
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

  private matchesRule(rule: PublicRule, method: string, path: string): boolean {
    if (rule.method !== '*' && rule.method !== method) return false;

    const patternSegments = rule.path.split('/');
    const pathSegments = path.replace(/\/+$/, '').split('/');

    for (let index = 0; index < patternSegments.length; index++) {
      const pattern = patternSegments[index];
      if (pattern === '**') return true;
      const segment = pathSegments[index];
      if (segment === undefined) return false;
      if (pattern !== '*' && pattern !== segment) return false;
      if (pattern === '*' && segment === '') return false;
    }
    return pathSegments.length === patternSegments.length;
  }
}
