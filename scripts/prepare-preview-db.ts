import { MikroORM } from '@mikro-orm/core';
import config from '../src/lib/mikro-orm.config';
import { getSchemaName } from '../src/lib/schema-utils';

/**
 * Ensures schema exists and runs migrations.
 *
 * Unlike Prisma which auto-creates schemas, MikroORM requires
 * explicit schema creation before migrations run.
 *
 * This single CREATE SCHEMA IF NOT EXISTS statement is idempotent
 * and lightweight - no separate "prepare" step, just ensuring the
 * namespace exists before migrations populate it.
 */
async function runMigrations() {
  const schemaName = getSchemaName();
  console.log(`[migrate] Target schema: ${schemaName}`);
  console.log(`[migrate] VERCEL_GIT_PULL_REQUEST_ID: ${process.env.VERCEL_GIT_PULL_REQUEST_ID || 'not set'}`);
  console.log(`[migrate] VERCEL_GIT_COMMIT_REF: ${process.env.VERCEL_GIT_COMMIT_REF || 'not set'}`);

  if (!process.env.DATABASE_URL) {
    console.error('[migrate] ERROR: DATABASE_URL is not set');
    process.exit(1);
  }

  try {
    const orm = await MikroORM.init(config);

    // Ensure schema exists (idempotent, lightweight)
    console.log(`[migrate] Ensuring schema "${schemaName}" exists...`);
    await orm.em.getConnection().execute(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);

    // Run migrations
    const migrator = orm.getMigrator();
    const pending = await migrator.getPendingMigrations();
    console.log(`[migrate] Pending migrations: ${pending.length}`);

    if (pending.length > 0) {
      await migrator.up();
      console.log(`[migrate] ✅ Migrations completed`);
    } else {
      console.log(`[migrate] ✅ Schema up-to-date`);
    }

    await orm.close(true);
  } catch (error) {
    console.error('[migrate] ❌ Failed:', error);
    process.exit(1);
  }
}

runMigrations();
