import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import { env } from './env';

async function bootstrap() {
  const app = setupApp(
    await NestFactory.create<NestExpressApplication>(AppModule),
  );
  await app.listen(env.PORT);
}
void bootstrap();
