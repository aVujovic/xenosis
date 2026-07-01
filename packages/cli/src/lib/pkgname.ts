/**
 * Conventions for naming generated packages.
 *
 * Given a workspace scope `@myorg` and a user-provided name `users`:
 *   - schema package → @myorg/psql-main             (name as-is)
 *   - api internal   → @myorg/<name>-api            (suffix added if missing)
 *   - api external   → @myorg/<name>-api            (suffix added if missing)
 *   - service        → users-service                (NO scope; suffix added)
 *
 * Services intentionally remain unscoped since they're never published.
 */

export function scopedSchemaName(scope: string, name: string): string {
  return scope.endsWith('/') ? `${scope}${name}` : `${scope}/${name}`;
}

export function scopedApiName(scope: string, name: string): string {
  const withSuffix = name.endsWith('-api') ? name : `${name}-api`;
  return scope.endsWith('/') ? `${scope}${withSuffix}` : `${scope}/${withSuffix}`;
}

/**
 * Event API package name: `<name>-events`.
 *   billing → @myorg/billing-events
 *   billing-events → @myorg/billing-events  (idempotent)
 */
export function scopedEventApiName(scope: string, name: string): string {
  const withSuffix = name.endsWith('-events') ? name : `${name}-events`;
  return scope.endsWith('/') ? `${scope}${withSuffix}` : `${scope}/${withSuffix}`;
}

export function eventApiDir(name: string): string {
  return name.endsWith('-events') ? name : `${name}-events`;
}

export function serviceName(name: string): string {
  return name.endsWith('-service') ? name : `${name}-service`;
}

/**
 * Returns the directory name (used inside structure.apis / structure.schemas /
 * structure.services) for a given user-provided name.
 */
export function schemaDir(name: string): string {
  return name;
}

export function apiDir(name: string): string {
  return name.endsWith('-api') ? name : `${name}-api`;
}

export function serviceDir(name: string): string {
  return name.endsWith('-service') ? name : `${name}-service`;
}

/**
 * Shared module package name: name as-is, no automatic suffix.
 *   whitelabel → @myorg/whitelabel
 *   feature-flags → @myorg/feature-flags
 */
export function scopedSharedModuleName(scope: string, name: string): string {
  return scope.endsWith('/') ? `${scope}${name}` : `${scope}/${name}`;
}

export function sharedModuleDir(name: string): string {
  return name;
}

/**
 * camelCase a kebab/snake/space-separated word.
 *   'psql-main' → 'psqlMain'
 *   'user_account' → 'userAccount'
 */
export function toCamel(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part, i) => (i === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join('');
}

/**
 * PascalCase: 'psql-main' → 'PsqlMain'
 */
export function toPascal(name: string): string {
  const camel = toCamel(name);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/**
 * Validates that a name is safe for use as a folder + package suffix.
 * Allows: lowercase letters, digits, dashes. No leading/trailing dash.
 */
export function validateName(name: string): string | null {
  if (!name) return 'Name is required.';
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/.test(name)) {
    return 'Name must be lowercase, may contain digits and dashes, and cannot start/end with a dash.';
  }
  return null;
}
