// Read-only health report for the /db dashboard: connection, server counters, table sizes, disk and uploads.
// Nothing here changes data, and no password or secret is ever put in the report.
const fs = require('fs');
const path = require('path');

const STATUS_KEYS = [
  'Uptime', 'Threads_connected', 'Threads_running', 'Max_used_connections', 'Connections', 'Questions',
  'Slow_queries', 'Aborted_connects', 'Aborted_clients', 'Bytes_received', 'Bytes_sent', 'Innodb_buffer_pool_pages_total',
  'Innodb_buffer_pool_pages_free',
];

async function safe(fn, fallback = null) {
  try { return await fn(); } catch (e) { return fallback; }
}

async function folderStats(dir) {
  let files = 0;
  let bytes = 0;
  for (const name of await fs.promises.readdir(dir)) {
    const st = await fs.promises.stat(path.join(dir, name)).catch(() => null);
    if (st && st.isFile()) { files += 1; bytes += st.size; }
  }
  return { files, bytes };
}

async function collect(pool, { uploadDir, remoteDb }) {
  const started = process.hrtime.bigint();
  let latencyMs = null;
  let connected = true;
  let error = null;
  try {
    await pool.query('SELECT 1');
    latencyMs = Math.round(Number(process.hrtime.bigint() - started) / 1e4) / 100;   // 2 decimals
  } catch (e) {
    connected = false;
    error = e.code || e.message;
  }

  const report = {
    connected,
    error,
    latencyMs,
    time: new Date().toISOString(),
    app: {
      nodeVersion: process.version,
      uptimeSec: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      env: process.env.NODE_ENV || 'development',
    },
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT) || 3306,
      database: process.env.DB_NAME || '',
      remote: !!remoteDb,
    },
    server: null,
    status: null,
    tables: [],
    totals: { rows: 0, bytes: 0 },
    content: null,
    uploads: null,
    disk: null,
  };

  if (connected) {
    const info = await safe(async () => (await pool.query(
      'SELECT VERSION() AS version, @@version_comment AS flavour, @@max_connections AS maxConnections, ' +
      '@@character_set_database AS charset, @@innodb_buffer_pool_size AS bufferPool, @@time_zone AS tz'
    ))[0][0]);
    report.server = info;

    const rows = await safe(async () => (await pool.query(
      `SHOW GLOBAL STATUS WHERE Variable_name IN (${STATUS_KEYS.map(() => '?').join(',')})`, STATUS_KEYS
    ))[0]);
    if (rows) report.status = Object.fromEntries(rows.map((r) => [r.Variable_name, Number(r.Value)]));

    const tables = await safe(async () => (await pool.query(
      'SELECT TABLE_NAME AS name, DATA_LENGTH AS dataBytes, INDEX_LENGTH AS indexBytes FROM information_schema.TABLES ' +
      'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = \'BASE TABLE\' ORDER BY TABLE_NAME'
    ))[0], []);
    for (const t of tables) {
      const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM \`${String(t.name).replace(/`/g, '')}\``);
      const bytes = Number(t.dataBytes) + Number(t.indexBytes);
      report.tables.push({ name: t.name, rows: Number(n), bytes });
      report.totals.rows += Number(n);
      report.totals.bytes += bytes;
    }

    const count = (sql) => safe(async () => Number((await pool.query(sql))[0][0].n), null);
    report.content = {
      listings: await count('SELECT COUNT(*) AS n FROM properties'),
      closed: await count('SELECT COUNT(*) AS n FROM properties WHERE is_closed = 1'),
      photos: await count('SELECT COUNT(*) AS n FROM property_photos'),
      team: await count('SELECT COUNT(*) AS n FROM team'),
      banners: await count('SELECT COUNT(*) AS n FROM hero_banners'),
      admins: await count('SELECT COUNT(*) AS n FROM admins WHERE active = 1'),
    };
  }

  report.uploads = await safe(async () => folderStats(uploadDir));
  report.disk = await safe(async () => {
    const s = await fs.promises.statfs(uploadDir);
    return { totalBytes: Number(s.blocks) * Number(s.bsize), freeBytes: Number(s.bavail) * Number(s.bsize) };
  });
  return report;
}

module.exports = { collect };
