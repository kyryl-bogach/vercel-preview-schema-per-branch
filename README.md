# Schema-per-Branch Preview Demo

**Portable solution for isolated preview deployments using Postgres schemas.**

This project demonstrates how to implement schema-per-branch preview deployments on Vercel without relying on vendor-specific database branching features (like Neon or PlanetScale). It works with any Postgres database.

## The Problem

When multiple developers work on features requiring database migrations:
- Running migrations in a shared preview database breaks other PRs
- Not running migrations means features can't be tested in preview
- Using the same database for all previews creates conflicts

## The Solution

**Schema-per-branch**: Each preview deployment gets an isolated Postgres schema within the same database.

```
Database: myapp
├── Schema: public (production)
├── Schema: feature_add_auth (PR #123)
├── Schema: bugfix_login_issue (PR #124)
└── Schema: refactor_api (PR #125)
```

### How It Works

1. **Build time**: Run migrations (single `CREATE SCHEMA IF NOT EXISTS` + migrations)
2. **Runtime**: App connects to schema (`pr_123` or sanitized branch name)
3. **PR close**: GitHub Action drops the schema

**Key insight**: You don't manually "prepare" the database. Just connect with the schema parameter and run migrations - one idempotent `CREATE SCHEMA IF NOT EXISTS` statement ensures the namespace exists, then migrations populate it.

**Benefits:**
- No separate database setup step
- Migrations are self-contained
- Works with any Postgres (no vendor lock-in)
- PR number strategy eliminates name collisions

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Vercel Preview Build                    │
├─────────────────────────────────────────────────────────────┤
│ 1. Read VERCEL_GIT_PULL_REQUEST_ID (preferred)             │
│    or VERCEL_GIT_COMMIT_REF (fallback)                      │
│ 2. Compute schema name: pr_123 or sanitized branch          │
│ 3. Run migration script:                                     │
│    - CREATE SCHEMA IF NOT EXISTS "pr_123"  (idempotent)     │
│    - Run pending migrations in that schema                   │
│ 4. Build Next.js app                                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Runtime (Serverless)                    │
├─────────────────────────────────────────────────────────────┤
│ • MikroORM connects with schema: "pr_123"                   │
│ • All queries scoped to that schema                          │
│ • Todos isolated per preview                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    PR Close (GitHub Action)                  │
├─────────────────────────────────────────────────────────────┤
│ 1. Get PR number or sanitize branch (same logic)            │
│ 2. DROP SCHEMA "pr_123" CASCADE                              │
└─────────────────────────────────────────────────────────────┘
```

## Setup

### 1. Clone & Install

```bash
git clone <your-repo>
cd vercel-preview-schema-per-branch
npm install
```

### 2. Database Setup

You need a Postgres database accessible from Vercel. This demo uses `postgres.bogach.es:5432`.

```bash
# Copy example env
cp .env.example .env.local

# Edit .env.local
DATABASE_URL=postgresql://user:password@postgres.bogach.es:5432/dbname
```

### 3. Create Initial Migration

```bash
npm run migration:create
```

This generates a migration in `src/migrations/` based on your entities.

### 4. Run Locally

```bash
npm run dev
```

Visit http://localhost:3000

The app will use the `public` schema by default for local development.

### 5. Deploy to Vercel

#### a. Create Vercel Project

```bash
vercel
```

#### b. Set Environment Variables

In Vercel dashboard → Settings → Environment Variables:

**All Environments:**
| Variable | Value | Scope |
|----------|-------|-------|
| `DATABASE_URL` | `postgresql://user:pass@postgres.bogach.es:5432/dbname` | All |

**Production Environment (Override):**
| Variable | Value | Scope |
|----------|-------|-------|
| `DATABASE_URL_WITH_SCHEMA` | `postgresql://user:pass@postgres.bogach.es:5432/dbname?schema=public` | Production |

**Develop Environment (Override - optional):**
| Variable | Value | Scope |
|----------|-------|-------|
| `DATABASE_URL_WITH_SCHEMA` | `postgresql://user:pass@postgres.bogach.es:5432/dbname?schema=develop` | Preview (filtered by branch: `develop`) |

**How it works:**

| Environment | DATABASE_URL | DATABASE_URL_WITH_SCHEMA | Computed URL |
|-------------|--------------|--------------------------|--------------|
| **Preview (PR #5)** | Set | Not set | `DATABASE_URL?schema=pr_5` |
| **Production** | Set | Set (override) | Uses override directly |
| **Develop branch** | Set | Set (override) | Uses override directly |

**Key points:**
- `DATABASE_URL` must be available at **build time** (not just runtime)
- Preview deployments auto-compute schema from PR number or branch name
- Production/Develop explicitly override to avoid auto-computed schemas

#### c. Set GitHub Secret

In GitHub → Settings → Secrets → Actions:

- Name: `DATABASE_URL`
- Value: `postgresql://user:pass@postgres.bogach.es:5432/dbname`

This is used by the cleanup workflow.

### 6. Test Preview Flow

1. Create a branch: `git checkout -b test/preview-schema`
2. Make a change, commit, push
3. Open a PR (e.g., PR #5)
4. Vercel builds preview:
   - Build logs show: `Target schema: pr_5`
   - Preview URL shows empty todo list with "Current schema: pr_5"
5. Add todos in preview - they're isolated to `pr_5` schema
6. Close/merge PR
7. GitHub Action runs and drops `pr_5` schema

## Project Structure

```
.
├── app/
│   ├── layout.tsx              # PicoCSS layout
│   └── page.tsx                # Todo UI (Server Components + Actions)
├── src/
│   ├── entities/
│   │   └── Todo.ts             # MikroORM entity
│   ├── lib/
│   │   ├── db.ts               # ORM singleton
│   │   ├── mikro-orm.config.ts # ORM config with dynamic schema
│   │   └── schema-utils.ts     # Branch name sanitization
│   └── migrations/             # Generated migrations
├── scripts/
│   └── prepare-preview-db.ts   # Pre-build: create schema + migrate
├── .github/workflows/
│   └── cleanup-preview.yml     # Drop schema on PR close
└── package.json                # Custom build script
```

## Key Files

### `src/lib/schema-utils.ts`

Schema naming strategy with PR number preference:

```typescript
export function getSchemaName(): string {
  // 1. Explicit override (production/develop)
  if (process.env.DB_SCHEMA) return process.env.DB_SCHEMA;

  // 2. PR number (preferred - "pr_123")
  if (process.env.VERCEL_GIT_PULL_REQUEST_ID) {
    return `pr_${process.env.VERCEL_GIT_PULL_REQUEST_ID}`;
  }

  // 3. Sanitized branch name (fallback)
  if (process.env.VERCEL_GIT_COMMIT_REF) {
    return sanitizeBranchName(process.env.VERCEL_GIT_COMMIT_REF);
  }

  // 4. Local dev default
  return 'public';
}
```

**Why PR number is preferred:**
- Guaranteed unique (no collisions)
- Short and safe (no character sanitization needed)
- Easier to track and cleanup

**Critical**: This logic must match between:
- App runtime (MikroORM config)
- Build script (migration runner)
- GitHub Action (cleanup)

### `src/lib/mikro-orm.config.ts`

Builds connection URL with schema parameter:

```typescript
function getDatabaseUrl(): string {
  // Production/develop override
  if (process.env.DATABASE_URL_WITH_SCHEMA) {
    return process.env.DATABASE_URL_WITH_SCHEMA;
  }

  // Preview: build dynamically
  const baseUrl = process.env.DATABASE_URL;
  const schemaName = getSchemaName(); // pr_123 or sanitized branch
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}schema=${schemaName}`;
}

export default defineConfig({
  clientUrl: getDatabaseUrl(), // Full URL with ?schema=
  // ... entities, migrations, etc.
});
```

**Benefits of this approach:**
- Uses standard `?schema=` connection string parameter (same as Prisma)
- Single `DATABASE_URL_WITH_SCHEMA` override for production/develop
- No need to manage schema as separate config option
- Cleaner Vercel environment variable setup

### `scripts/prepare-preview-db.ts`

Runs during `npm run build`:

1. Ensures schema exists (`CREATE SCHEMA IF NOT EXISTS` - idempotent)
2. Runs pending migrations in that schema
3. Fails build if database unreachable

**Key difference from manual preparation**: This is a single lightweight SQL statement, not a separate "prepare" phase. The schema is created as part of the migration process, just like Prisma's `migrate deploy` does automatically.

### `package.json`

```json
{
  "scripts": {
    "build": "npm run migrate && next build",
    "migrate": "tsx scripts/prepare-preview-db.ts"
  }
}
```

### `.github/workflows/cleanup-preview.yml`

Triggers on PR close:

```yaml
- name: Drop schema
  run: |
    psql "${{ secrets.DATABASE_URL }}" \
      -c "DROP SCHEMA IF EXISTS \"$SCHEMA\" CASCADE"
```

## Verification

### Check Active Schemas

```sql
-- List all preview schemas (pr_* pattern)
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name LIKE 'pr_%'
   OR schema_name NOT IN ('pg_catalog', 'information_schema', 'public')
ORDER BY schema_name;
```

You should see schemas like `pr_5`, `pr_7`, etc.

### Test Schema Isolation

1. Open PR #5 (schema: `pr_5`)
2. Open PR #7 (schema: `pr_7`)
3. Add todo "Task from PR 5" in preview for PR #5
4. Add todo "Task from PR 7" in preview for PR #7
5. Verify todos don't leak between previews (each shows different schema name)

### Monitor Build Logs

In Vercel build logs, look for:

```
[migrate] Target schema: pr_123
[migrate] VERCEL_GIT_PULL_REQUEST_ID: 123
[migrate] Ensuring schema "pr_123" exists...
[migrate] Pending migrations: 2
[migrate] ✅ Migrations completed
```

## Limitations

### 1. Not True Isolation

Database-level objects are shared:
- **Extensions**: `CREATE EXTENSION postgis` affects entire database
- **Types**: Custom enums, composite types are global
- **Functions**: Stored procedures are database-wide

**Impact**: One PR's migration creating a type can conflict with another PR.

**Mitigation**: Avoid database-level objects in migrations, or coordinate manually.

### 2. Connection Pool Limits

All previews share the same connection pool.

**Impact**: 10 active previews = 10x connections to same database.

**Mitigation**: Use connection pooling (PgBouncer) or limit active previews.

### 3. Schema Name Collisions

**Solved by default**: This implementation uses `VERCEL_GIT_PULL_REQUEST_ID` (e.g., `pr_123`) by default, which guarantees uniqueness.

**Fallback caveat**: If PR ID is unavailable (e.g., first push before PR is opened), it falls back to sanitized branch names, where collisions are theoretically possible but rare:
- `feature/add-auth` → `feature_add_auth`
- `feature_add_auth` → `feature_add_auth`

### 4. Manual Cleanup Dependency

If GitHub Action fails, schemas accumulate.

**Mitigation**:
- Monitor schema count
- Add cron job to clean stale schemas
- Check `pg_stat_user_tables` for last access time

### 5. Build-Time Migration Failures

If migration fails, build fails, schema is left in dirty state.

**Mitigation**:
- Test migrations locally first
- Use idempotent migrations
- Add rollback logic to prepare script

## Production/Develop Branches

Override the complete connection URL for production/develop:

**Vercel Environment Variables**:
```bash
# Production
DATABASE_URL_WITH_SCHEMA=postgresql://user:pass@host:5432/db?schema=public

# Develop (optional)
DATABASE_URL_WITH_SCHEMA=postgresql://user:pass@host:5432/db?schema=develop
```

When `DATABASE_URL_WITH_SCHEMA` is set, it takes precedence over the auto-computed URL. This is cleaner than managing separate `DB_SCHEMA` variables.

## Troubleshooting

### Build fails: "relation does not exist"

**Cause**: Migration not run in preview schema.

**Fix**: Check build logs for migration errors. Ensure `npm run migrate` runs before `next build`.

### Todos not persisting

**Cause**: Schema not created or wrong schema being used.

**Fix**: Check runtime logs for schema name. Verify `getSchemaName()` returns correct value.

### Cleanup action fails

**Cause**: `DATABASE_URL` secret not set or malformed.

**Fix**: Verify GitHub secret matches Vercel env var exactly. Test locally:

```bash
export DATABASE_URL="postgresql://..."
psql "$DATABASE_URL" -c "SELECT 1"
```

### Schema quota exceeded

**Cause**: Too many stale schemas.

**Fix**: Manually clean:

```sql
-- List schemas with row counts
SELECT
  schema_name,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = schema_name) as table_count
FROM information_schema.schemata
WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'public')
ORDER BY schema_name;

-- Drop stale schemas
DROP SCHEMA IF EXISTS "old_branch_name" CASCADE;
```

## When NOT to Use This

Use database branching (Neon, PlanetScale) instead if you need:
- **True isolation**: Extensions, types, connection limits
- **Zero ops**: Automatic cleanup without GitHub Actions
- **Large teams**: 10+ concurrent PRs
- **Production-scale previews**: Realistic data volumes

This solution trades operational simplicity for portability.

## Extending This Demo

### Add Prisma Support

Replace MikroORM with Prisma:

```typescript
// src/lib/prisma.ts
import { PrismaClient } from '@prisma/client';
import { getSchemaName } from './schema-utils';

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `${process.env.DATABASE_URL}?schema=${getSchemaName()}`,
    },
  },
});
```

**Note**: Prisma uses connection string parameter `?schema=`, not schema option.

### Add Monitoring

```typescript
// scripts/monitor-schemas.ts
import { Client } from 'pg';

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query(`
  SELECT
    schema_name,
    pg_size_pretty(sum(pg_total_relation_size(table_schema || '.' || table_name))::bigint) as size
  FROM information_schema.tables
  WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  GROUP BY schema_name
  ORDER BY sum(pg_total_relation_size(table_schema || '.' || table_name)) DESC;
`);

console.table(rows);
```

Run weekly via GitHub Actions cron.

## License

MIT

## Contributing

This is a demo project. Feel free to fork and adapt for your needs.

## References

- [Neon Branching Docs](https://neon.tech/docs/guides/branching)
- [PlanetScale Branching](https://planetscale.com/docs/concepts/branching)
- [Prisma Schema Parameter](https://www.prisma.io/docs/concepts/components/prisma-schema/data-sources#postgresql-schema-parameter)
- [MikroORM Multi-tenancy](https://mikro-orm.io/docs/usage-with-multiple-schemas)
- [Postgres Schema Docs](https://www.postgresql.org/docs/current/ddl-schemas.html)
