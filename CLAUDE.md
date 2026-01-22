# Claude Context: Schema-per-Branch Preview Demo

This is a demonstration project showing **schema-per-branch preview deployments** on Vercel using MikroORM and PostgreSQL.

## Project Goal

Demonstrate isolated preview environments without vendor lock-in. Each PR gets its own Postgres schema within a single database. Works with any Postgres instance.

## Architecture

```
PR opened → Vercel build → migrations run in pr_X schema → app connects to pr_X
PR closed → GitHub Action → DROP SCHEMA pr_X CASCADE
```

**Schema naming strategy:**
1. PR number (preferred): `pr_123` from `VERCEL_GIT_PULL_REQUEST_ID`
2. Sanitized branch (fallback): `feature/auth` → `feature_auth`
3. Production override: `DB_SCHEMA=public` env var
4. Local dev default: `public`

## Critical MikroORM Knowledge

### 1. Schema Configuration (Most Important)

MikroORM requires **BOTH** `schema` config option **AND** `search_path` for migrations to work correctly:

```typescript
// src/lib/mikro-orm.config.ts
export default defineConfig({
  entities: [Todo],
  clientUrl: process.env.DATABASE_URL,  // Plain URL, NO ?schema= parameter
  schema: schemaName,  // Scopes queries
  driverOptions: {
    connection: {
      options: `-c search_path=${schemaName}`,  // Critical for migration tracking
    },
  },
});
```

**Why both:**
- `schema` alone → migrations run but tracking fails (table already exists errors)
- `search_path` alone → queries not scoped properly
- Both together → migrations tracked per schema correctly

Reference: https://github.com/mikro-orm/mikro-orm/discussions/1886

### 2. Entity Definition Rules

```typescript
@Entity({ tableName: 'todo' })  // MUST: Explicit table name prevents minification
export class Todo {
  @PrimaryKey({ autoincrement: true })  // MUST: Explicit type
  id!: number;

  @Property({ type: 'string' })  // MUST: Explicit type
  title!: string;
}
```

**Critical:** Next.js production builds minify class names (`Todo` → `h`). Without explicit `tableName`, MikroORM derives table name from minified class, causing "table h not found" errors.

### 3. Entity Imports

```typescript
// ✅ CORRECT
entities: [Todo]

// ❌ WRONG - fails in Next.js production
entities: ['./src/entities/**/*.ts']
```

File path globs don't work in Next.js production builds.

### 4. Entity Persistence

```typescript
// ✅ CORRECT
const todo = new Todo();
todo.title = title;
await em.persistAndFlush(todo);

// ❌ UNRELIABLE
const todo = em.create(Todo, { title });
await em.flush();
```

Direct instantiation is more reliable for ensuring entities are properly marked as new.

### 5. Reflect Metadata

Add `import 'reflect-metadata'` at the top of:
- `src/lib/db.ts`
- Any script using MikroORM

Required because `tsx` (esbuild) doesn't support `emitDecoratorMetadata`.

## Key Files

### `src/lib/schema-utils.ts`
Schema name computation logic. **MUST match between:**
- App runtime (MikroORM config)
- GitHub Action cleanup script

Priority: `DB_SCHEMA` env → PR ID → branch name → `public`

### `src/lib/mikro-orm.config.ts`
ORM configuration with dynamic schema. Uses both `schema` option and `search_path`.

### `src/lib/db.ts`
Singleton ORM instance. Imports `reflect-metadata`.

### `src/entities/Todo.ts`
Entity with explicit `tableName` and types in all decorators.

### `app/page.tsx`
Todo CRUD using Next.js Server Components and Server Actions.
- Uses `new Todo()` for persistence
- Button-based toggle (not checkbox with onChange - Server Component limitation)

### `package.json`
Build script: `"build": "npm run migrate && next build"`
Migration script: `"migrate": "mikro-orm migration:up"`

### `.github/workflows/cleanup-preview.yml`
Drops schema when PR closes. Uses `secrets.DATABASE_URL` to connect.

## Vercel Setup

### Environment Variables

| Variable | Value | Environment | Purpose |
|----------|-------|-------------|---------|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db` | All | Base connection string (required at build time) |
| `DB_SCHEMA` | `public` | Production | Override to force specific schema |

**Important:** `DATABASE_URL` must be available at **build time**, not just runtime (needed for migrations).

### How Schema is Selected

1. Check `DB_SCHEMA` env var (production override)
2. Check `VERCEL_GIT_PULL_REQUEST_ID` → `pr_123`
3. Check `VERCEL_GIT_COMMIT_REF` → sanitize to valid identifier
4. Default to `public` (local dev)

## GitHub Setup

### Repository Secret

Settings → Secrets and variables → Actions → Secrets:

| Name | Value | Used For |
|------|-------|----------|
| `DATABASE_URL` | Full connection string | Cleanup action to drop schemas |

Must be **Secret** (not Variable) because it contains credentials.

## Common Issues

### "Table already exists" (42P07)

**Cause:** Migration tracking not in correct schema.

**Fix:** Verify both `schema` config and `search_path` are set in `mikro-orm.config.ts`.

**Debug:** Check if `mikro_orm_migrations` table exists in the schema:
```sql
SELECT * FROM pr_X.mikro_orm_migrations;
```

### Todos not persisting

**Cause:** Wrong schema at runtime.

**Fix:** Check logs for `[mikro-orm.config] Schema: ...` - verify matches PR number.

### Table "h" does not exist

**Cause:** Entity class name minified, no explicit `tableName`.

**Fix:** Add `@Entity({ tableName: 'todo' })` to entity.

### "Please provide either 'type' or 'entity' attribute"

**Cause:** Missing `reflect-metadata` import or explicit types in decorators.

**Fix:**
1. Add `import 'reflect-metadata'` to `src/lib/db.ts`
2. Add explicit types: `@Property({ type: 'string' })`

### Cleanup action fails

**Cause:** `DATABASE_URL` secret not set or incorrect.

**Fix:** Verify GitHub secret matches Vercel env var exactly.

## Project Constraints

1. **Simple demo** - Keep code minimal, no over-engineering
2. **No vendor lock-in** - Must work with any Postgres
3. **Single database** - All schemas in one DB (not separate databases)
4. **No manual schema creation** - Migrations handle schema creation via MikroORM
5. **PR number preferred** - More reliable than branch names (no collisions)

## Schema Isolation Testing

1. Create PR #2, PR #3 (multiple PRs)
2. Add todos in PR #2 preview → stored in `pr_2` schema
3. Add todos in PR #3 preview → stored in `pr_3` schema
4. Verify todos don't leak between previews
5. Close PR #2 → verify `pr_2` schema dropped
6. PR #3 still works independently

## Limitations (By Design)

1. **Shared connection pool** - All previews share DB connection limits
2. **Database-level objects shared** - Extensions, types, functions not schema-scoped
3. **Manual cleanup required** - GitHub Action must run (not automatic)
4. **Build failures leave dirty state** - Failed migrations don't auto-rollback

These are acceptable tradeoffs for portability.

## Do NOT Do

1. ❌ Add `CREATE SCHEMA` statements to migrations - MikroORM handles this
2. ❌ Use `?schema=` URL parameter - Use `schema` config option instead
3. ❌ Use file path globs for entities - Direct imports only
4. ❌ Add complexity "for future needs" - Keep it simple
5. ❌ Create separate database preparation scripts - Migrations are self-contained
6. ❌ Use `DATABASE_URL_WITH_SCHEMA` - Code uses `DB_SCHEMA` for overrides

## Tech Stack

- **Next.js 15** - App Router, Server Components, Server Actions
- **MikroORM 6** - PostgreSQL ORM with schema support
- **PicoCSS** - Minimal styling (classless CSS)
- **PostgreSQL** - Any instance (demo uses postgres.bogach.es:5432)
- **Vercel** - Preview deployments with system env vars
- **GitHub Actions** - Schema cleanup on PR close

## Migration Workflow

**Creating migrations:**
```bash
npm run migration:create  # Generates migration from entity changes
```

**Running migrations:**
- Automatic during Vercel build via `npm run build`
- Manual: `npm run migrate`

**What happens:**
1. MikroORM connects with `schema: schemaName`
2. Sets `search_path` via driverOptions
3. Creates schema if doesn't exist
4. Runs pending migrations
5. Updates `mikro_orm_migrations` tracking table in schema

## Philosophy

This project demonstrates **pragmatic isolation** - not perfect isolation (use Neon for that), but good enough isolation that works anywhere, trades operational complexity for portability.

Keep solutions simple. The goal is to prove the concept works, not to build production-ready infrastructure.
