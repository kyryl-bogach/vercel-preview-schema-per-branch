# Schema-per-Branch Preview Demo

Portable solution for isolated preview deployments using Postgres schemas. Works with any Postgres database - no vendor lock-in.

## How It Works

Each PR gets its own isolated Postgres schema:

```
Database: myapp
├── Schema: public          (production)
├── Schema: pr_2            (PR #2)
├── Schema: pr_3            (PR #3)
└── Schema: pr_4            (PR #4)
```

**Flow:**
1. **PR opened** → Vercel builds → migrations run in `pr_X` schema
2. **Runtime** → app queries `pr_X` schema → todos isolated
3. **PR closed** → GitHub Action drops `pr_X` schema

## Setup

### 1. Local Development

```bash
npm install
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL
npm run dev
```

### 2. Vercel Environment Variables

In Vercel Project Settings → Environment Variables, add:

| Variable | Value | Environment |
|----------|-------|-------------|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db` | All Environments |
| `DB_SCHEMA` | `public` | Production (optional override) |

**Why these variables:**
- `DATABASE_URL` - Base connection string for all environments, required at build time for migrations
- `DB_SCHEMA` - Optional override for production/develop to force specific schema instead of auto-computed

**How schema is determined:**
- Preview deployments: `pr_X` (from `VERCEL_GIT_PULL_REQUEST_ID`)
- Fallback: sanitized branch name (e.g., `feature/auth` → `feature_auth`)
- Production override: `DB_SCHEMA=public` forces public schema
- Local dev: defaults to `public`

### 3. GitHub Secret

In Repository Settings → Secrets and variables → Actions → Secrets:

| Name | Value | Used For |
|------|-------|----------|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db` | Schema cleanup on PR close |

**Why a secret:**
Contains database credentials - must be encrypted. The GitHub Action needs this to connect and drop schemas when PRs close.

### 4. GitHub Action (Already Configured)

`.github/workflows/cleanup-preview.yml` automatically drops schemas when PRs close:

```yaml
on:
  pull_request:
    types: [closed]

jobs:
  cleanup:
    steps:
      - name: Drop schema
        run: |
          psql "${{ secrets.DATABASE_URL }}" \
            -c "DROP SCHEMA IF EXISTS \"pr_${{ github.event.pull_request.number }}\" CASCADE"
```

## MikroORM-Specific Considerations

### 1. Schema Configuration

MikroORM requires **both** `schema` config option **and** `search_path` for migrations to work properly:

```typescript
// src/lib/mikro-orm.config.ts
export default defineConfig({
  entities: [Todo],
  clientUrl: process.env.DATABASE_URL,  // Plain URL, no ?schema= parameter
  schema: schemaName,  // Tells MikroORM which schema to use
  driverOptions: {
    connection: {
      options: `-c search_path=${schemaName}`,  // Critical for migration tracking
    },
  },
});
```

**Why both are needed:**
- `schema` option - Scopes queries to the schema
- `search_path` - Ensures migration tracking table (`mikro_orm_migrations`) is created in the correct schema

Without `search_path`, migrations will run but tracking gets confused, causing "table already exists" errors on rebuilds.

Reference: [MikroORM GitHub Discussion #1886](https://github.com/mikro-orm/mikro-orm/discussions/1886)

### 2. Entity Definition

Explicitly set table names to prevent minification issues in production builds:

```typescript
@Entity({ tableName: 'todo' })  // Prevents Next.js from minifying class name
export class Todo {
  @PrimaryKey({ autoincrement: true })  // Explicit type needed
  id!: number;

  @Property({ type: 'string' })  // Explicit types required
  title!: string;
}
```

### 3. Entity Imports

Import entities directly, not via file paths:

```typescript
// ✅ Good
entities: [Todo]

// ❌ Bad (fails in Next.js production)
entities: ['./src/entities/**/*.ts']
```

### 4. Entity Persistence

Use direct instantiation with `persistAndFlush`:

```typescript
// ✅ Good
const todo = new Todo();
todo.title = title;
await em.persistAndFlush(todo);

// ❌ Unreliable
const todo = em.create(Todo, { title });
await em.flush();
```

### 5. Decorator Metadata

Add `import 'reflect-metadata'` at the top of:
- `src/lib/db.ts`
- Any script that uses MikroORM (e.g., migration scripts)

This is required because `tsx` (used for running scripts) doesn't support `emitDecoratorMetadata`.

## Testing Schema Isolation

1. Create a PR (e.g., PR #2)
2. Check Vercel build logs for: `[mikro-orm.config] Schema: pr_2`
3. Open preview URL - add todos
4. Create another PR (PR #3) - add different todos
5. Verify todos don't leak between previews
6. Close PR #2 - check database to confirm `pr_2` schema is dropped

```sql
-- List all preview schemas
SELECT schema_name FROM information_schema.schemata
WHERE schema_name LIKE 'pr_%';
```

## How Migrations Work

Build script runs `mikro-orm migration:up` which:
1. Connects to database with `schema` config
2. Sets `search_path` to target schema
3. Creates schema if it doesn't exist (via MikroORM)
4. Runs pending migrations in that schema
5. Tracks completed migrations in `mikro_orm_migrations` table within the schema

**Key insight:** No manual "prepare" step needed. MikroORM handles schema creation when you provide the `schema` config option.

## Limitations

1. **Shared connection pool** - All previews share connection limits
2. **Database-level objects** - Extensions, types, functions are global (not schema-scoped)
3. **Manual cleanup dependency** - If GitHub Action fails, schemas accumulate
4. **Build failures leave dirty state** - Failed migrations leave schema in inconsistent state

## Project Structure

```
.
├── app/
│   ├── layout.tsx           # Root layout
│   └── page.tsx             # Todo CRUD UI
├── src/
│   ├── entities/
│   │   └── Todo.ts          # MikroORM entity
│   ├── lib/
│   │   ├── db.ts            # ORM singleton
│   │   ├── mikro-orm.config.ts    # Schema + search_path config
│   │   └── schema-utils.ts        # Schema name logic
│   └── migrations/          # Generated migrations
├── .github/workflows/
│   └── cleanup-preview.yml  # Drop schema on PR close
└── package.json             # Build: migrate → next build
```

## Troubleshooting

### "Table already exists" error

**Cause:** Migration tracking not in correct schema.

**Fix:** Ensure both `schema` config and `search_path` are set in `mikro-orm.config.ts`.

### Todos not persisting

**Cause:** Wrong schema being used at runtime.

**Fix:** Check app logs for `[mikro-orm.config] Schema: ...` - verify it matches PR number.

### GitHub Action fails

**Cause:** `DATABASE_URL` secret not set or incorrect.

**Fix:** Verify secret in GitHub Settings → Secrets → Actions matches exact connection string from Vercel.

### Schema quota exceeded

**Cause:** Stale schemas from failed cleanup.

**Fix:** Manually drop old schemas:
```sql
DROP SCHEMA IF EXISTS pr_5 CASCADE;
```

## When to Use This vs. Neon/PlanetScale

**Use schema-per-branch when:**
- You already have a Postgres database
- You want portability (no vendor lock-in)
- You have < 10 concurrent PRs

**Use Neon/PlanetScale when:**
- You need true isolation (extensions, connection limits)
- You want zero-ops (automatic cleanup)
- You have 10+ concurrent PRs

This solution trades operational complexity for portability.

## License

MIT
