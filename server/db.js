require('dotenv').config(process.env.ENV_FILE ? { path: process.env.ENV_FILE } : undefined);
const mysql = require('mysql2/promise');

// One shared connection pool for the whole app
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;
