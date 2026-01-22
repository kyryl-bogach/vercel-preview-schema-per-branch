import { defineConfig } from '@mikro-orm/postgresql';
import { getSchemaName } from './schema-utils';

/**
 * Builds the database URL with schema parameter.
 *
 * Strategy:
 * 1. If DATABASE_URL_WITH_SCHEMA is set (production/develop override), use it
 * 2. Otherwise, build it from DATABASE_URL + ?schema=<computed_name>
 */
function getDatabaseUrl(): string {
  // Explicit override (production/develop)
  if (process.env.DATABASE_URL_WITH_SCHEMA) {
    return process.env.DATABASE_URL_WITH_SCHEMA;
  }

  // Build dynamically for preview
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const schemaName = getSchemaName();

  // Check if URL already has query params
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}schema=${schemaName}`;
}

export default defineConfig({
  entities: ['./dist/entities'],
  entitiesTs: ['./src/entities'],
  clientUrl: getDatabaseUrl(),
  migrations: {
    path: './dist/migrations',
    pathTs: './src/migrations',
  },
  debug: process.env.NODE_ENV === 'development',
});
