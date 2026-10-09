import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import { randomBytes } from 'node:crypto';

/**
 * The session cookie signing secret.
 *
 * `process.env.SESSION_SECRET || 'secret'` meant a deployment that forgot to
 * set it signed its session cookies with the literal string "secret" — anyone
 * could mint a valid signed cookie. In production the process refuses to start
 * without a real one; in development a random per-boot value is used, which
 * logs everyone out on restart rather than being guessable.
 */
function resolveSessionSecret(): string {
  const configured = process.env.SESSION_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (configured && configured.length >= 32 && configured !== 'change-this-to-a-random-64-char-string-at-least') {
    return configured;
  }
  if (isProduction) {
    throw new Error(
      'SESSION_SECRET must be set to a unique value of at least 32 characters in production. ' +
        'Generate one with: openssl rand -hex 32',
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    '[startup] SESSION_SECRET is unset or too short; using a random secret for this process. ' +
      'Sessions will not survive a restart.',
  );
  return randomBytes(32).toString('hex');
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // 50 MB was enough for one request to pin the single API process. CSV
  // imports are the only large body, and they are bounded separately.
  const bodyLimit = process.env.MAX_JSON_BODY || '8mb';
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ limit: bodyLimit, extended: true }));
  app.use(cookieParser(resolveSessionSecret()));
  app.setGlobalPrefix('api');
  // Behind Caddy the app must trust X-Forwarded-* or `secure` cookies and
  // client IPs are wrong.
  app.set('trust proxy', 1);
  
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:9000',
    credentials: true,
  });
  
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}/api`);
}

bootstrap();
