/**
 * Database configuration - reads from environment variables
 * Pattern based on scripts/lib/db-config.js
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from project root (parent of mcp directory)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export const ATLAS_CONFIG: DatabaseConfig = {
  host: process.env.LOCAL_DB_HOST || 'localhost',
  port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
  user: process.env.LOCAL_DB_USER || 'root',
  password: process.env.LOCAL_DB_PASSWORD || '',
  database: process.env.LOCAL_DB_NAME || 'atlas'
};

export function validateConfig(): void {
  if (!ATLAS_CONFIG.password) {
    throw new Error('LOCAL_DB_PASSWORD not set in environment');
  }
}
