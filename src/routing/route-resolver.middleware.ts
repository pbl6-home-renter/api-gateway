import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { RouteTableService, type RouteEntry } from './route-table.service';
import { RequestPath } from '../common/request-path';

export interface RoutedRequest extends Request {
  /** Set once a matching, configured route is found. Guaranteed present in downstream middleware. */
  gatewayRoute?: RouteEntry;
}

/** Resolves the backend route for the request path, or responds 404 if none is configured. */
@Injectable()
export class RouteResolverMiddleware implements NestMiddleware {
  constructor(private readonly routeTable: RouteTableService) {}

  use(request: RoutedRequest, response: Response, next: NextFunction): void {
    const route = this.routeTable.resolve(RequestPath.of(request));
    if (!route?.baseUrl) {
      response.status(404).json({ statusCode: 404, code: 'ROUTE_NOT_FOUND' });
      return;
    }
    request.gatewayRoute = route;
    next();
  }
}
