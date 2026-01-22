import { defineConfig } from '@mikro-orm/postgresql';
import { getSchemaName } from './schema-utils';
import { Todo } from '../entities/Todo';

const schemaName = getSchemaName();

// Log for debugging (visible in Vercel build logs)
console.log(`[mikro-orm.config] Schema: ${schemaName}`);
console.log(`[mikro-orm.config] DATABASE_URL: ${process.env.DATABASE_URL?.substring(0, 50)}...`);
console.log(`[mikro-orm.config] VERCEL_GIT_PULL_REQUEST_ID: ${process.env.VERCEL_GIT_PULL_REQUEST_ID || 'not set'}`);
console.log(`[mikro-orm.config] VERCEL_GIT_COMMIT_REF: ${process.env.VERCEL_GIT_COMMIT_REF || 'not set'}`);

export default defineConfig({
  entities: [Todo],
  clientUrl: process.env.DATABASE_URL,
  schema: schemaName,
  migrations: {
    tableName: 'mikro_orm_migrations',
    path: './src/migrations',
    pathTs: './src/migrations',
    glob: '!(*.d).{js,ts}',
    // Set search_path to ensure migrations run in correct schema
    emit: 'ts',
  },
  driverOptions: {
    connection: {
      options: `-c search_path=${schemaName}`,
    },
  },
  debug: process.env.NODE_ENV === 'development',
});
