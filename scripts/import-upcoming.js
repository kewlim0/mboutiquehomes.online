// One-off import of the owner-contact list from a JSON file made by scripts/belfield-sheet-to-json.py:
//   node scripts/import-upcoming.js private-files/import/upcoming.json "Project name"
// The rows go into that project (created when it does not exist yet; with no name: Sunway Belfield Residence).
// The JSON holds real owner data (names, phone numbers), so it is never kept in the repository. The import only adds rows and
// refuses to run when owners already exist (so running it twice cannot create duplicates).
const fs = require('fs');
const pool = require('../server/db');
const upcoming = require('../server/upcoming');

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('用法：node scripts/import-upcoming.js <upcoming.json>'); process.exit(1); }
  const projectName = (process.argv[3] || 'Sunway Belfield Residence').trim();
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  await upcoming.ensureUpcoming();
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM upcoming_owners o JOIN upcoming_projects p ON p.id = o.project_id WHERE p.name = ?', [projectName]);
  if (n > 0) { console.error(`项目「${projectName}」里已经有 ${n} 位业主，为了不重复导入，什么都没做。`); process.exit(2); }
  const out = await upcoming.importAll(rows, projectName);
  console.log(`✓ 导入完成：${out.owners} 位业主，放进项目「${projectName}」`);
  await pool.end();
})().catch((err) => { console.error('✗ 导入失败：', err.message); process.exit(1); });
