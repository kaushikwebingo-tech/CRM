import { Global, Module } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export const DATABASE = Symbol('DATABASE');
export const PG_CLIENT = Symbol('PG_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: PG_CLIENT,
      useFactory: () => {
        return postgres(process.env.DATABASE_URL as string);
      },
    },
    {
      provide: DATABASE,
      inject: [PG_CLIENT],
      useFactory: (client: postgres.Sql) => {
        return drizzle(client, { schema });
      },
    },
  ],
  exports: [DATABASE, PG_CLIENT],
})
export class DatabaseModule {}
