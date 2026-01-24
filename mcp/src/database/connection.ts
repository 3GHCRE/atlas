/**
 * Database connection pool management
 */
import mysql, { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { ATLAS_CONFIG, validateConfig } from '../config.js';

let pool: Pool | null = null;

/**
 * Get or create the connection pool (lazy initialization)
 */
export function getPool(): Pool {
  if (!pool) {
    validateConfig();
    pool = mysql.createPool({
      ...ATLAS_CONFIG,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0
    });
  }
  return pool;
}

/**
 * Execute a query and return results
 */
export async function query<T extends RowDataPacket[]>(
  sql: string,
  params?: (string | number | null | undefined)[]
): Promise<T> {
  const p = getPool();
  // Use query() instead of execute() for more flexibility with parameter types
  const [rows] = await p.query<T>(sql, params);
  return rows;
}

/**
 * Execute a query and return a single row or null
 */
export async function queryOne<T extends RowDataPacket>(
  sql: string,
  params?: (string | number | null | undefined)[]
): Promise<T | null> {
  const rows = await query<T[]>(sql, params);
  return rows[0] || null;
}

/**
 * Close the connection pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Test database connectivity
 */
export async function testConnection(): Promise<boolean> {
  try {
    const p = getPool();
    const conn = await p.getConnection();
    await conn.ping();
    conn.release();
    return true;
  } catch (error) {
    return false;
  }
}
