import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { GatewayConfigService } from './config/gateway-config.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // The gateway only forwards requests; it never reads the body itself,
    // so the raw stream is left untouched and proxied as-is (this also
    // makes multipart/form uploads work, which a parsed-then-reserialized
    // body cannot).
    bodyParser: false,
  });
  app.set('trust proxy', 1);
  app.enableCors({ origin: true, credentials: true });

  const config = app.get(GatewayConfigService);
  await app.listen(config.port);
}

void bootstrap();
