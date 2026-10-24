import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { GatewayConfigService } from './config/gateway-config.service';
import { CorrelationId, type CorrelatedRequest } from './common/correlation-id';
import { CORRELATION_ID_HEADER } from './constants/headers.constants';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // The gateway only forwards requests; it never reads the body itself,
    // so the raw stream is left untouched and proxied as-is (this also
    // makes multipart/form uploads work, which a parsed-then-reserialized
    // body cannot).
    bodyParser: false,
  });
  app.set('trust proxy', 1);

  // Run before CORS and the Nest middleware chain so even short-circuited
  // responses (preflight, health, 401, 404, 429, 503) carry a trace ID.
  app.use((request: Request, response: Response, next: NextFunction) => {
    const correlationId = CorrelationId.resolve(request);
    (request as CorrelatedRequest).correlationId = correlationId;
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    next();
  });

  const config = app.get(GatewayConfigService);
  // Tokens travel in the Authorization header and request body, never in
  // cookies, so credentials are not needed.
  app.enableCors({
    origin: [...config.corsOrigins],
    credentials: false,
    exposedHeaders: ['x-correlation-id', 'Retry-After'],
  });
  await app.listen(config.port);
}

void bootstrap();
