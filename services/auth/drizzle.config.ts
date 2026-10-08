import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  schemaFilter: ['auth'],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://ecommerce:ecommerce@localhost:5432/auth',
  },
  strict: true,
  verbose: true,
});
