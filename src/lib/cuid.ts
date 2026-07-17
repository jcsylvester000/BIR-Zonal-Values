import { randomUUID } from "node:crypto";

/**
 * Generate a collision-resistant id for a row inserted via raw SQL.
 *
 * The Prisma `@default(cuid())` only fires through the Prisma query builder,
 * not through `$executeRaw`. The bulk-import path uses a raw multi-row INSERT
 * (Neon's HTTP driver can't run `createMany`, which needs a transaction), so it
 * must supply ids itself. A prefixed UUID is more than sufficient here and
 * needs no extra dependency.
 */
export function createId(): string {
  return `z_${randomUUID()}`;
}
