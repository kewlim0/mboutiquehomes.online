// Creates the tables (if missing) and inserts the default content when the tables are empty.
//   npm run db:init
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  if (!DB_USER || !DB_NAME) {
    console.error('请先在 .env 里填写 DB_USER / DB_PASSWORD / DB_NAME（参考 .env.example）');
    process.exit(1);
  }

  // Connect without a database first so we can create it if it does not exist yet.
  const conn = await mysql.createConnection({
    host: DB_HOST || '127.0.0.1',
    port: Number(DB_PORT) || 3306,
    user: DB_USER,
    password: DB_PASSWORD,
    charset: 'utf8mb4',
    multipleStatements: true,
  });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${DB_NAME}\``);
  await conn.query(fs.readFileSync(path.join(__dirname, '..', 'server', 'schema.sql'), 'utf8'));
  await conn.end();
  console.log('✓ 数据表已就绪');

  const repo = require('../server/repo');
  const seeded = await repo.seedDefaults();
  console.log(seeded ? '✓ 已写入默认内容（房源、团队、横幅）' : '• 数据库里已有内容，跳过默认数据');
  process.exit(0);
}

main().catch((err) => {
  console.error('初始化失败：', err.message);
  process.exit(1);
});
