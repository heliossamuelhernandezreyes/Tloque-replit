import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Una caída de la base no debe acumular conexiones o peticiones eternas.
  // Los límites pueden afinarse mediante Secrets sin aceptar valores extremos.
  max: boundedInteger(process.env.DB_POOL_MAX, 10, 1, 30),
  connectionTimeoutMillis: boundedInteger(process.env.DB_CONNECT_TIMEOUT_MS, 10_000, 1_000, 60_000),
  idleTimeoutMillis: boundedInteger(process.env.DB_IDLE_TIMEOUT_MS, 30_000, 1_000, 300_000),
  query_timeout: boundedInteger(process.env.DB_QUERY_TIMEOUT_MS, 30_000, 5_000, 120_000),
});
export const db = drizzle(pool, { schema });
