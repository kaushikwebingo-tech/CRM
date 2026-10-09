import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import postgres from 'postgres';
import Redis from 'ioredis';
import { AutomationsService } from './automations/automations.service';
import { OutboxWorkerService } from './automations/outbox-worker.service';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://crm:crm_secret@localhost:5432/crm';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const sql = postgres(databaseUrl);
const redis = new Redis(redisUrl);

const automationsService = new AutomationsService(sql);
const worker = new OutboxWorkerService(sql, redis, automationsService);

worker.start();

const shutdown = async () => {
  await worker.stop();
  await redis.quit();
  await sql.end();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
