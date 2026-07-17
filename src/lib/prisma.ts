import { PrismaClient } from "@prisma/client";
import { PrismaNeonHTTP } from "@prisma/adapter-neon";

/**
 * Prisma client singleton, backed by Neon's SQL-over-HTTPS driver.
 *
 * Why HTTP and not a raw Postgres connection: this app runs in an environment
 * where outbound TCP to Postgres port 5432 is not available, but HTTPS (443) to
 * Neon is. Neon's serverless driver speaks SQL over HTTPS, so Prisma reaches
 * the same database without a 5432 socket. This is also the recommended path
 * for serverless / edge deploys, so it carries forward cleanly.
 *
 * Next.js dev mode hot-reloads modules, which would otherwise build a new
 * client on every reload. Caching the instance on `globalThis` in non-prod
 * keeps a single client across reloads.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const adapter = new PrismaNeonHTTP(connectionString!, {});
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
