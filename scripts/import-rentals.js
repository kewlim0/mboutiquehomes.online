// One-off import of rental units, tenants and bills from a JSON file:
//   node scripts/import-rentals.js /path/to/rentals.json
// The JSON holds real tenant data, so it is never kept in the repository. The import only adds rows and
// refuses to run when units already exist (so running it twice cannot create duplicates).
const fs = require('fs');
const pool = require('../server/db');
const rentals = require('../server/rentals');

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('用法：node scripts/import-rentals.js <rentals.json>'); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  await rentals.ensureRentals();
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM rental_units');
  if (n > 0) { console.error(`已经有 ${n} 个单位，为了不重复导入，什么都没做。`); process.exit(2); }
  const out = await rentals.importAll(data);
  console.log(`✓ 导入完成：${out.units} 个单位、${out.tenants} 位租客、${out.bills} 张账单、${out.items} 个项目`);
  await pool.end();
})().catch((err) => { console.error('✗ 导入失败：', err.message); process.exit(1); });
