import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

loadDotenv();

export default defineConfig({
  schema: './src/db/app/schema.ts',
  out: './src/db/app/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.APP_DATABASE_URL ?? 'postgres://app:app@localhost:5433/app',
  },
});
