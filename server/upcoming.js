// Owners to follow up for upcoming listings (the /tracker/upcoming/ page): one row per unit of a condo, with the owner's
// contact details, what we know about the unit (tenanted until..., for sale, owner-stay, not reachable) and the next follow-up date.
// Everything here sits behind the admin sign-in; none of it is part of the public site content.
const pool = require('./db');
const { HttpError } = require('./validate');

let ready = null;
function ensureUpcoming() {
  if (!ready) {
    ready = pool.query(`CREATE TABLE IF NOT EXISTS upcoming_owners (
      id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
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
      KEY idx_upcoming_next (next_followup)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch((err) => { ready = null; throw err; });
  }
  return ready;
}

// ---------- validation ----------
const STATUSES = ['tenant', 'sale', 'own', 'noanswer', 'none', 'listed'];
const TYPES = ['', 'C', 'D', 'E', 'F', 'C/E', 'D/F'];
const LINES = ['', '2R', '4R', 'BIG'];

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
  const line = text(b.line, '单位类别', 8);
  if (!STATUSES.includes(status)) throw new HttpError(400, '状态无效');
  if (!TYPES.includes(type)) throw new HttpError(400, '户型无效');
  if (!LINES.includes(line)) throw new HttpError(400, '单位类别无效');
  return {
    unit: text(b.unit, '单位', 30, { required: true }).toUpperCase(),
    name: text(b.name, '业主姓名', 160),
    phone: text(b.phone, '电话', 40),
    type, line, status,
    tenancyEnd: dateOrNull(b.tenancyEnd, '租约到期日'),
    nextFollowup: dateOrNull(b.nextFollowup, '下次跟进日'),
    note: text(b.note, '备注', 4000),
  };
}

// ---------- reading ----------
const COLS = `id, unit, name, phone, type, line, status, DATE_FORMAT(tenancy_end, '%Y-%m-%d') AS tenancy_end,
  DATE_FORMAT(next_followup, '%Y-%m-%d') AS next_followup, DATE_FORMAT(last_followup, '%Y-%m-%d') AS last_followup, note`;
const map = (r) => ({
  id: r.id, unit: r.unit, name: r.name, phone: r.phone, type: r.type, line: r.line, status: r.status,
  tenancyEnd: r.tenancy_end, nextFollowup: r.next_followup, lastFollowup: r.last_followup, note: r.note || '',
});

async function listAll() {
  await ensureUpcoming();
  const [rows] = await pool.query(`SELECT ${COLS} FROM upcoming_owners ORDER BY unit`);
  return { owners: rows.map(map) };
}
async function getOne(id) {
  const [rows] = await pool.query(`SELECT ${COLS} FROM upcoming_owners WHERE id = ?`, [id]);
  return rows.length ? map(rows[0]) : null;
}

// ---------- writing ----------
async function create(o) {
  await ensureUpcoming();
  const [res] = await pool.query(
    `INSERT INTO upcoming_owners (unit, name, phone, type, line, status, tenancy_end, next_followup, note) VALUES (?,?,?,?,?,?,?,?,?)`,
    [o.unit, o.name, o.phone, o.type, o.line, o.status, o.tenancyEnd, o.nextFollowup, o.note]);
  return getOne(res.insertId);
}
async function update(id, o) {
  await ensureUpcoming();
  const [res] = await pool.query(
    `UPDATE upcoming_owners SET unit=?, name=?, phone=?, type=?, line=?, status=?, tenancy_end=?, next_followup=?, note=? WHERE id = ?`,
    [o.unit, o.name, o.phone, o.type, o.line, o.status, o.tenancyEnd, o.nextFollowup, o.note, id]);
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

// One-off import (scripts/import-upcoming.js): rows are validated like a form submit, in one transaction
async function importAll(rows) {
  await ensureUpcoming();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let n = 0;
    for (const raw of rows) {
      const o = owner(raw);
      await conn.query(
        `INSERT INTO upcoming_owners (unit, name, phone, type, line, status, tenancy_end, next_followup, note) VALUES (?,?,?,?,?,?,?,?,?)`,
        [o.unit, o.name, o.phone, o.type, o.line, o.status, o.tenancyEnd, o.nextFollowup, o.note]);
      n++;
    }
    await conn.commit();
    return { owners: n };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { ensureUpcoming, owner, listAll, create, update, markFollowed, remove, importAll, dateOrNull, STATUSES };
