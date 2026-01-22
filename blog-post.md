# Stop Using Database Branching for Previews: Postgres Schemas Are Enough

Isolated preview environments per PR using plain Postgres schemas - no database branching, no vendor lock-in.

**[View demo repo](https://github.com/kyryl-bogach/vercel-preview-schema-per-branch) • [See live examples](https://github.com/kyryl-bogach/vercel-preview-schema-per-branch/pulls)**

---

## The Preview Environment Problem

Have you ever pushed a feature branch that needs database migrations, only to realize your preview deployment can't actually test it?

We ran into this exact problem when adding a new table migration to a feature PR - the preview showed the UI but crashed on every query.

**The dilemma:**
- Run migrations in a shared preview database? Breaks other developers' PRs
- Skip migrations? Can't test your feature properly
- Use production data? Absolutely not

The "obvious" solution is database branching services like Neon or PlanetScale. They're excellent products, but they come with tradeoffs: vendor lock-in, another service to manage and pay for, migration complexity if you already have a Postgres database.

## There's a Simpler Way

What if I told you Postgres has had a built-in solution for 20+ years? **Schemas.**

Not database schemas in the abstract sense. Literal PostgreSQL schemas. Namespaces within a single database.

```
Database: myapp
├── Schema: public          (production)
├── Schema: pr_15           (feature/add-auth)
├── Schema: pr_16           (bugfix/login)
└── Schema: pr_17           (refactor/api)
```

Each PR gets its own isolated schema. Same database, separate data.

## How It Works

The approach is dead simple:

1. **On preview build:** Run migrations in schema `pr_X` (where X is the PR number)
2. **At runtime:** Connect to schema `pr_X`
3. **On PR close:** Drop schema `pr_X`

That's it. No complex setup, no new services, no vendor lock-in.

### The Key Insight

Modern ORMs (Prisma, MikroORM, TypeORM, Drizzle) all support schema parameters:

```typescript
// Prisma
datasources {
  db {
    url = "postgresql://user:pass@host/db?schema=pr_15"
  }
}

// MikroORM
defineConfig({
  schema: 'pr_15',
  driverOptions: {
    connection: { options: '-c search_path=pr_15' }
  }
})

// TypeORM
{
  schema: 'pr_15'
}
```

You're probably already one config option away from this working.

## Implementation

### Step 1: Compute Schema Name

Use your platform's environment variables:

```typescript
// Vercel
const schemaName =
  process.env.VERCEL_GIT_PULL_REQUEST_ID
    ? `pr_${process.env.VERCEL_GIT_PULL_REQUEST_ID}`
    : 'public';

// Netlify
const schemaName =
  process.env.REVIEW_ID
    ? `pr_${process.env.REVIEW_ID}`
    : 'public';

// Railway
const schemaName =
  process.env.RAILWAY_GIT_BRANCH
    ? sanitizeBranchName(process.env.RAILWAY_GIT_BRANCH)
    : 'public';
```

Pro tip: Use PR numbers, not branch names. Branch names like `feature/add-auth` need sanitization. PR numbers are guaranteed unique and safe.

### Step 2: Configure Your ORM

Pass the computed schema to your ORM:

```typescript
// Prisma example
const databaseUrl = process.env.DATABASE_URL;
const schemaName = getSchemaName();
const url = `${databaseUrl}?schema=${schemaName}`;

export const prisma = new PrismaClient({
  datasources: { db: { url } }
});
```

### Step 3: Run Migrations in Build

Add to your build script:

```json
{
  "scripts": {
    "build": "npm run migrate && next build",
    "migrate": "prisma migrate deploy"
  }
}
```

The magic here: when your ORM runs migrations with `?schema=pr_15`, it automatically creates the schema if it doesn't exist (depending on the ORM), then runs migrations inside it.

### Step 4: Cleanup on PR Close

GitHub Action (works for any platform):

```yaml
name: Cleanup Preview Schema

on:
  pull_request:
    types: [closed]

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Drop schema
        run: |
          psql "${{ secrets.DATABASE_URL }}" \
            -c "DROP SCHEMA IF EXISTS \"pr_${{ github.event.pull_request.number }}\" CASCADE"
```

## Real Example: Next.js + MikroORM

Here's a working implementation from [kyryl-bogach/vercel-preview-schema-per-branch](https://github.com/kyryl-bogach/vercel-preview-schema-per-branch):

[View source code](https://github.com/kyryl-bogach/vercel-preview-schema-per-branch) • [See live PRs with isolated previews](https://github.com/kyryl-bogach/vercel-preview-schema-per-branch/pulls)

**Schema computation:**
```typescript
// src/lib/schema-utils.ts
export function getSchemaName(): string {
  // Production override
  if (process.env.DB_SCHEMA) {
    return process.env.DB_SCHEMA;
  }

  // PR number (preferred)
  if (process.env.VERCEL_GIT_PULL_REQUEST_ID) {
    return `pr_${process.env.VERCEL_GIT_PULL_REQUEST_ID}`;
  }

  // Local dev default
  return 'public';
}
```

**ORM config:**
```typescript
// src/lib/mikro-orm.config.ts
import { defineConfig } from '@mikro-orm/postgresql';
import { getSchemaName } from './schema-utils';

const schemaName = getSchemaName();

export default defineConfig({
  entities: [Todo],
  clientUrl: process.env.DATABASE_URL,
  schema: schemaName,
  driverOptions: {
    connection: {
      options: `-c search_path=${schemaName}`,
    },
  },
});
```

**Build script:**
```json
{
  "scripts": {
    "build": "npm run migrate && next build",
    "migrate": "mikro-orm migration:up"
  }
}
```

**Vercel environment variables:**
- `DATABASE_URL` = `postgresql://user:pass@host:5432/db` (all environments)
- `DB_SCHEMA` = `public` (production only, forces specific schema)

That's the entire setup. Three files, one environment variable, one GitHub secret.

## Testing It Out

1. Create a PR (e.g., PR #15)
2. Vercel builds, migrations run in `pr_15` schema
3. Open preview URL, add some todos
4. Create another PR (e.g., PR #16), add different todos
5. Check both previews - completely isolated
6. Close PR #15, schema `pr_15` dropped automatically

Each preview has its own data. No conflicts, no shared state.

**See it in action:** Check out the [demo PRs](https://github.com/kyryl-bogach/vercel-preview-schema-per-branch/pulls) in the repo. Each has its own Vercel preview with isolated data.

## The Honest Tradeoffs

This isn't a silver bullet. Here's what you're trading:

**What you gain:**
- Works with any Postgres database
- No vendor lock-in
- Simple mental model (schemas, not "branches")
- One database to manage
- Standard SQL operations

**What you lose:**
- Manual cleanup (GitHub Action can fail)
- Shared connection pool (all previews use same DB connections)
- Database-level objects are shared (extensions, types)
- Not true isolation (one DB, multiple namespaces)

**When to use this:**
- You already have a Postgres database
- You want portability
- You have less than 10 concurrent PRs
- You're okay with "good enough" isolation

**When to use Neon/PlanetScale:**
- You need true isolation
- You want zero-ops (automatic cleanup)
- You have 10+ concurrent PRs
- You need production-scale preview data

## Why This Matters

Database branching services are great, but they shouldn't be required for basic preview isolation.

Postgres schemas have existed since 1999. Your database already has this feature. Your ORM already supports it. You just need to wire it up.

This approach gives you:
- **Portability** - Switch databases without rewriting your deployment pipeline
- **Simplicity** - One database, one connection string, schema parameter does the rest
- **Control** - It's just SQL, you understand exactly what's happening

## Try It Yourself

I've built a working demo with Next.js + MikroORM showing the full implementation:

**Repository:** [kyryl-bogach/vercel-preview-schema-per-branch](https://github.com/kyryl-bogach/vercel-preview-schema-per-branch)

The repo includes:
- Complete working example with full source code
- Migration setup and schema utilities
- GitHub Action for automatic cleanup
- README (quick start) and CLAUDE.md (deep context)

**Live examples:** Browse the [open PRs](https://github.com/kyryl-bogach/vercel-preview-schema-per-branch/pulls) to see:
- Each PR's Vercel preview deployment
- Build logs showing schema creation (`pr_2`, `pr_3`, etc.)
- Isolated todo lists per preview
- Schema cleanup when PRs close

Clone it, deploy it to Vercel, open some PRs, and see isolated schemas in action.

## Final Thoughts

Sometimes the best solution isn't the newest service - it's the 20-year-old feature hiding in plain sight.

Postgres schemas aren't perfect for this use case (they were designed for multi-tenancy, not preview environments), but they're **good enough** and **work everywhere**.

If you're building on Vercel/Netlify/Railway with an existing Postgres database, give this approach a try. You might find it's exactly the level of isolation you need, without the operational overhead of another service.

---

**What do you think?** Have you tried schema-per-branch deployments? Running into issues with the approach? Let me know - I'd love to hear about your setup.

*Found this useful? Star the repo and share with your team.*
