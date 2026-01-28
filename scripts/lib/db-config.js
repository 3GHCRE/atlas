/**
 * Database configuration - reads from .env
 * Usage: const { getAtlasConnection, getReapiConnection } = require('./lib/db-config');
 */
const mysql = require('mysql2/promise');
const path = require('path');

// Load .env from project root
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const ATLAS_CONFIG = {
  host: process.env.LOCAL_DB_HOST || '192.168.65.254',
  port: parseInt(process.env.LOCAL_DB_PORT || '3306'),
  user: process.env.LOCAL_DB_USER || 'root',
  password: process.env.LOCAL_DB_PASSWORD || 'devpass',
  database: process.env.LOCAL_DB_NAME || 'atlas'
};

const REAPI_CONFIG = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '25060'),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'cms_data',
  ssl: { rejectUnauthorized: false },
  connectTimeout: 30000
};

async function getAtlasConnection() {
  if (!ATLAS_CONFIG.password) {
    throw new Error('LOCAL_DB_PASSWORD not set in .env');
  }
  return mysql.createConnection(ATLAS_CONFIG);
}

async function getReapiConnection() {
  if (!REAPI_CONFIG.host || !REAPI_CONFIG.password) {
    throw new Error('DB_HOST or DB_PASSWORD not set in .env');
  }
  return mysql.createConnection(REAPI_CONFIG);
}

module.exports = {
  ATLAS_CONFIG,
  REAPI_CONFIG,
  getAtlasConnection,
  getReapiConnection
};
