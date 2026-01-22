/**
 * Sanitizes a branch name to be a valid PostgreSQL schema identifier.
 *
 * Rules:
 * - Replace forward slashes and dashes with underscores
 * - Remove all non-alphanumeric characters except underscores
 * - Convert to lowercase
 * - Truncate to 60 characters (Postgres limit is 63, leaving room for prefixes)
 * - Fallback to 'public' if result is empty
 */
export function sanitizeBranchName(branch: string): string {
  const sanitized = branch
    .replace(/[\/\-]/g, '_')           // Replace / and - with _
    .replace(/[^a-zA-Z0-9_]/g, '_')   // Remove other special chars
    .toLowerCase()
    .substring(0, 60);

  return sanitized || 'public';
}

/**
 * Gets the schema name for the current environment.
 *
 * Strategy Priority:
 * 1. DB_SCHEMA env var (explicit override for production/develop)
 * 2. VERCEL_GIT_PULL_REQUEST_ID (safest - PR number like "pr_123")
 * 3. Sanitized VERCEL_GIT_COMMIT_REF (fallback - branch name)
 * 4. 'public' (local dev default)
 *
 * Why PR number is preferred:
 * - Guaranteed unique (no collisions)
 * - Short and safe characters
 * - Easier to track/cleanup
 */
export function getSchemaName(): string {
  // 1. Explicit override (production/develop)
  if (process.env.DB_SCHEMA) {
    return process.env.DB_SCHEMA;
  }

  // 2. PR number strategy (recommended)
  const prId = process.env.VERCEL_GIT_PULL_REQUEST_ID;
  if (prId) {
    return `pr_${prId}`;
  }

  // 3. Branch name strategy (fallback)
  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  if (branch) {
    return sanitizeBranchName(branch);
  }

  // 4. Local dev fallback
  return 'public';
}
