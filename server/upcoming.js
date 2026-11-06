// Owners to follow up for upcoming listings (the /tracker/upcoming/ page): one row per unit of a condo, with the owner's
// contact details, what we know about the unit (tenanted until..., for sale, owner-stay, not reachable) and the next follow-up date.
// Everything here sits behind the admin sign-in; none of it is part of the public site content.
const pool = require('./db');
const { HttpError } = require('./validate');

// The unit types of the first project (Sunway Belfield Residence), by the last part of the unit number (B-48-03 -> 03)
const BELFIELD_TYPES = [
  { code: 'A1', suffixes: ['03'], note: '' }, { code: 'A2', suffixes: ['03A'], note: '' }, { code: 'B', suffixes: ['08', '09'], note: '' },
  { code: 'C', suffixes: ['01', '06'], note: '' }, { code: 'D', suffixes: ['02', '05'], note: '' }, { code: 'E', suffixes: ['07', '10'], note: '' },
];
const suffixOf = (unit) => { const u = String(unit || '').trim().toUpperCase(); return u.includes('-') ? u.split('-').pop() : u.slice(-2); };
const typeOf = (unit, types) => { const sfx = suffixOf(unit); const t = (types || []).find((x) => x.suffixes.includes(sfx)); return t ? t.code : ''; };

let ready = null;
function ensureUpcoming() {
  if (!ready) {
    ready = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS upcoming_projects (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name       VARCHAR(120) NOT NULL,
        types      TEXT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await pool.query(`CREATE TABLE IF NOT EXISTS upcoming_owners (
        id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        project_id    INT UNSIGNED NULL,
        unit          VARCHAR(30)  NOT NULL,
        name          VARCHAR(160) NOT NULL DEFAULT '',
        phone         VARCHAR(40)  NOT NULL DEFAULT '',
        type          VARCHAR(8)   NOT NULL DEFAULT '',
        line          VARCHAR(8)   NOT NULL DEFAULT '',
        status        VARCHAR(10)  NOT NULL DEFAULT 'none',
        tenancy_end   DATE NULL,
        next_followup DATE NULL,
        last_followup DATE NULL,
        note          TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_upcoming_unit (unit),
        KEY idx_upcoming_end (tenancy_end),
        KEY idx_upcoming_next (next_followup),
        KEY idx_upcoming_project (project_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      // the first version had no projects: its owners all belong to Sunway Belfield Residence, and their types now follow the unit number
      const [have] = await pool.query("SHOW COLUMNS FROM upcoming_owners LIKE 'project_id'");
      if (!have.length) {
        await pool.query('ALTER TABLE upcoming_owners ADD COLUMN project_id INT UNSIGNED NULL AFTER id, ADD KEY idx_upcoming_project (project_id)');
      }
      const [[{ orphans }]] = await pool.query('SELECT COUNT(*) AS orphans FROM upcoming_owners WHERE project_id IS NULL');
      if (orphans > 0) {
        let [[first]] = await pool.query("SELECT id FROM upcoming_projects WHERE name = 'Sunway Belfield Residence' LIMIT 1");
        if (!first) {
          const [r] = await pool.query('INSERT INTO upcoming_projects (name, types) VALUES (?, ?)', ['Sunway Belfield Residence', JSON.stringify(BELFIELD_TYPES)]);
          first = { id: r.insertId };
        }
        await pool.query('UPDATE upcoming_owners SET project_id = ? WHERE project_id IS NULL', [first.id]);
        const [rows] = await pool.query('SELECT id, unit FROM upcoming_owners WHERE project_id = ?', [first.id]);
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          for (const r of rows) { const t = typeOf(r.unit, BELFIELD_TYPES); if (t) await conn.query('UPDATE upcoming_owners SET type = ? WHERE id = ?', [t, r.id]); }
          await conn.commit();
        } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
      }
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

// ---------- validation ----------
const STATUSES = ['tenant', 'sale', 'own', 'noanswer', 'none', 'listed'];

const text = (value, label, max, { required = false } = {}) => {
  const s = typeof value === 'string' ? value.trim() : (value == null ? '' : String(value).trim());
  if (required && !s) throw new HttpError(400, `${label}不能为空`);
  if (s.length > max) throw new HttpError(400, `${label}太长（最多 ${max} 个字符）`);
  return s;
};
const dateOrNull = (value, label) => {
  if (value === undefined || value === null || value === '') return null;
  const s = typeof value === 'string' ? value.trim() : '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new HttpError(400, `${label}无效`);
  return s;
};

function owner(body) {
  const b = body && typeof body === 'object' ? body : {};
  const status = text(b.status, '状态', 10) || 'none';
  const type = text(b.type, '户型', 8);
  const projectId = Number(b.projectId);
  if (!STATUSES.includes(status)) throw new HttpError(400, '状态无效');
  if (!Number.isInteger(projectId) || projectId < 1) throw new HttpError(400, '请选择项目');
  return {
    projectId,
    unit: text(b.unit, '单位', 30, { required: true }).toUpperCase(),
    name: text(b.name, '业主姓名', 160),
    phone: text(b.phone, '电话', 40),
    type, line: '', status,
    tenancyEnd: dateOrNull(b.tenancyEnd, '租约到期日'),
    nextFollowup: dateOrNull(b.nextFollowup, '下次跟进日'),
    note: text(b.note, '备注', 4000),
  };
}

// A project: a name and its unit types. Each type has a code ("A1"), the unit-number endings that belong to it (["03"]) and a free note.
function project(body) {
  const b = body && typeof body === 'object' ? body : {};
  const raw = Array.isArray(b.types) ? b.types : [];
  if (raw.length > 30) throw new HttpError(400, '户型最多 30 种');
  const seenCode = new Set(), seenSuffix = new Set(), types = [];
  for (const t of raw) {
    const code = text(t && t.code, '户型名称', 8);
    const suffixes = (Array.isArray(t && t.suffixes) ? t.suffixes : String((t && t.suffixes) || '').split(/[,，\s]+/)).map((x) => String(x).trim().toUpperCase()).filter(Boolean);
    if (!code && !suffixes.length) continue;
    if (!code) throw new HttpError(400, '每一种户型都要有名称');
    if (seenCode.has(code.toLowerCase())) throw new HttpError(400, `户型「${code}」重复了`);
    seenCode.add(code.toLowerCase());
    for (const x of suffixes) {
      if (x.length > 8) throw new HttpError(400, `单位尾号「${x}」太长`);
      if (seenSuffix.has(x)) throw new HttpError(400, `单位尾号「${x}」同时出现在两种户型里`);
      seenSuffix.add(x);
    }
    types.push({ code, suffixes, note: text(t && t.note, '户型备注', 200) });
  }
  return { name: text(b.name, '项目名称', 120, { required: true }), types, applyTypes: b.applyTypes === true };
}

// ---------- reading ----------
const COLS = `id, project_id, unit, name, phone, type, line, status, DATE_FORMAT(tenancy_end, '%Y-%m-%d') AS tenancy_end,
  DATE_FORMAT(next_followup, '%Y-%m-%d') AS next_followup, DATE_FORMAT(last_followup, '%Y-%m-%d') AS last_followup, note`;
const map = (r) => ({
  id: r.id, projectId: r.project_id, unit: r.unit, name: r.name, phone: r.phone, type: r.type, line: r.line, status: r.status,
  tenancyEnd: r.tenancy_end, nextFollowup: r.next_followup, lastFollowup: r.last_followup, note: r.note || '',
});

const mapProject = (r) => ({ id: r.id, name: r.name, types: (() => { try { return JSON.parse(r.types || '[]'); } catch (e) { return []; } })() });

async function listAll() {
  await ensureUpcoming();
  const [projects] = await pool.query('SELECT id, name, types FROM upcoming_projects ORDER BY sort_order, id');
  const [rows] = await pool.query(`SELECT ${COLS} FROM upcoming_owners ORDER BY unit`);
  return { projects: projects.map(mapProject), owners: rows.map(map) };
}
async function getProject(id) {
  const [rows] = await pool.query('SELECT id, name, types FROM upcoming_projects WHERE id = ?', [id]);
  return rows.length ? mapProject(rows[0]) : null;
}
async function getOne(id) {
  const [rows] = await pool.query(`SELECT ${COLS} FROM upcoming_owners WHERE id = ?`, [id]);
  return rows.length ? map(rows[0]) : null;
}

// ---------- writing ----------
async function create(o) {
  await ensureUpcoming();
  const proj = await getProject(o.projectId);
  if (!proj) throw new HttpError(400, '找不到这个项目');
  o.type = o.type || typeOf(o.unit, proj.types);   // no type given: it follows from the ending of the unit number
  const [res] = await pool.query(
    `INSERT INTO upcoming_owners (project_id, unit, name, phone, type, line, status, tenancy_end, next_followup, note) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [o.projectId, o.unit, o.name, o.phone, o.type, o.line, o.status, o.tenancyEnd, o.nextFollowup, o.note]);
  return getOne(res.insertId);
}
async function update(id, o) {
  await ensureUpcoming();
  const proj = await getProject(o.projectId);
  if (!proj) throw new HttpError(400, '找不到这个项目');
  o.type = o.type || typeOf(o.unit, proj.types);
  const [res] = await pool.query(
    `UPDATE upcoming_owners SET project_id=?, unit=?, name=?, phone=?, type=?, line=?, status=?, tenancy_end=?, next_followup=?, note=? WHERE id = ?`,
    [o.projectId, o.unit, o.name, o.phone, o.type, o.line, o.status, o.tenancyEnd, o.nextFollowup, o.note, id]);
  return res.affectedRows ? getOne(id) : null;
}
// "followed up today": remember the day, set the next follow-up date and optionally add a line to the notes
async function markFollowed(id, { nextFollowup, note }) {
  await ensureUpcoming();
  const old = await getOne(id);
  if (!old) return null;
  const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
  const line = note ? `${stamp} ${note}` : '';
  const merged = [line, old.note].filter(Boolean).join('\n');
  if (merged.length > 4000) throw new HttpError(400, '备注太长了');
  await pool.query('UPDATE upcoming_owners SET last_followup = ?, next_followup = ?, note = ? WHERE id = ?', [stamp, nextFollowup, merged, id]);
  return getOne(id);
}
async function remove(id) {
  await ensureUpcoming();
  const [res] = await pool.query('DELETE FROM upcoming_owners WHERE id = ?', [id]);
  return res.affectedRows > 0;
}

// ---------- projects ----------
async function applyTypes(projectId) {
  const p = await getProject(projectId);
  if (!p) return 0;
  const [rows] = await pool.query('SELECT id, unit, type FROM upcoming_owners WHERE project_id = ?', [projectId]);
  let n = 0;
  for (const r of rows) { const t = typeOf(r.unit, p.types); if (t && t !== r.type) { await pool.query('UPDATE upcoming_owners SET type = ? WHERE id = ?', [t, r.id]); n++; } }
  return n;
}
async function createProject(p) {
  await ensureUpcoming();
  const [[{ top }]] = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS top FROM upcoming_projects');
  const [res] = await pool.query('INSERT INTO upcoming_projects (name, types, sort_order) VALUES (?, ?, ?)', [p.name, JSON.stringify(p.types), top]);
  return getProject(res.insertId);
}
async function updateProject(id, p) {
  await ensureUpcoming();
  const [res] = await pool.query('UPDATE upcoming_projects SET name = ?, types = ? WHERE id = ?', [p.name, JSON.stringify(p.types), id]);
  if (!res.affectedRows) return null;
  if (p.applyTypes) await applyTypes(id);
  return getProject(id);
}
async function removeProject(id) {
  await ensureUpcoming();
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM upcoming_owners WHERE project_id = ?', [id]);
  if (n > 0) throw new HttpError(400, `这个项目里还有 ${n} 位业主，不能直接删除`);
  const [res] = await pool.query('DELETE FROM upcoming_projects WHERE id = ?', [id]);
  return res.affectedRows > 0;
}

// One-off import (scripts/import-upcoming.js): rows go into one project (created when it does not exist yet); validated like a form submit, in one transaction
async function importAll(rows, projectName) {
  await ensureUpcoming();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let [[proj]] = await conn.query('SELECT id, types FROM upcoming_projects WHERE name = ? LIMIT 1', [projectName]);
    if (!proj) {
      const [[{ top }]] = await conn.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS top FROM upcoming_projects');
      const [r] = await conn.query('INSERT INTO upcoming_projects (name, types, sort_order) VALUES (?, ?, ?)', [projectName, '[]', top]);
      proj = { id: r.insertId, types: '[]' };
    }
    const types = (() => { try { return JSON.parse(proj.types || '[]'); } catch (e) { return []; } })();
    let n = 0;
    for (const raw of rows) {
      const o = owner({ ...raw, projectId: proj.id });
      await conn.query(
        `INSERT INTO upcoming_owners (project_id, unit, name, phone, type, line, status, tenancy_end, next_followup, note) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [proj.id, o.unit, o.name, o.phone, o.type || typeOf(o.unit, types), o.line, o.status, o.tenancyEnd, o.nextFollowup, o.note]);
      n++;
    }
    await conn.commit();
    return { owners: n, projectId: proj.id };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { ensureUpcoming, owner, project, listAll, create, update, markFollowed, remove, createProject, updateProject, removeProject, importAll, dateOrNull, STATUSES };
