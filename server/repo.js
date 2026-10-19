// All SQL lives here. Rows are mapped to the same shape the front end already uses
// ({ title: { zh, en }, priceRM, ... }), and an empty English text falls back to the Chinese one.
const fs = require('fs');
const path = require('path');
const pool = require('./db');
const seedData = require('./seed-data');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

const pair = (zh, en) => ({ zh, en: en || zh });

function mapProperty(r) {
  return {
    id: r.id,
    title: pair(r.title_zh, r.title_en),
    type: r.type,
    priceRM: Number(r.price_rm),
    isRentPrice: r.type === 'rent',
    areaSqft: r.area_sqft,
    beds: pair(r.beds_zh, r.beds_en),
    area: r.area,
    location: pair(r.location_zh, r.location_en),
    address: r.address,
    img: r.img,
    status: pair(r.status_zh, r.status_en),
    desc: pair(r.description_zh || '', r.description_en),
  };
}

function mapTeam(r) {
  return {
    id: r.id,
    name: r.name,
    role: pair(r.role_zh, r.role_en),
    meta: pair(r.meta_zh, r.meta_en),
    img: r.img,
  };
}

async function getHero() {
  const [rows] = await pool.query("SELECT `value` FROM settings WHERE `key` = 'hero_img'");
  return rows.length ? rows[0].value : seedData.hero.img;
}

async function getContent() {
  const [props] = await pool.query('SELECT * FROM properties ORDER BY sort_order ASC, id DESC');
  const [team] = await pool.query('SELECT * FROM team ORDER BY sort_order ASC, id ASC');
  return { hero: { img: await getHero() }, properties: props.map(mapProperty), team: team.map(mapTeam) };
}

// ---------- uploaded-file cleanup ----------
// Remove an uploaded file once nothing in the database points to it any more.
async function removeIfOrphan(imgPath) {
  if (!/^uploads\/[a-f0-9]+\.(jpg|png|webp|gif)$/.test(imgPath || '')) return;
  const [rows] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM properties WHERE img = ?)
          + (SELECT COUNT(*) FROM team WHERE img = ?)
          + (SELECT COUNT(*) FROM settings WHERE \`value\` = ?) AS n`,
    [imgPath, imgPath, imgPath]
  );
  if (Number(rows[0].n) === 0) {
    fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(imgPath))).catch(() => {});
  }
}

// ---------- properties ----------
const propertyValues = (p) => [
  p.title.zh, p.title.en, p.type, p.priceRM, p.areaSqft, p.beds.zh, p.beds.en, p.area,
  p.location.zh, p.location.en, p.address, p.img, p.status.zh, p.status.en, p.desc.zh, p.desc.en,
];

async function createProperty(p) {
  // New listings go to the top of the list
  const [[{ top }]] = await pool.query('SELECT COALESCE(MIN(sort_order), 0) - 1 AS top FROM properties');
  const [res] = await pool.query(
    `INSERT INTO properties (title_zh, title_en, type, price_rm, area_sqft, beds_zh, beds_en, area,
       location_zh, location_en, address, img, status_zh, status_en, description_zh, description_en, sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [...propertyValues(p), top]
  );
  return res.insertId;
}

async function updateProperty(id, p) {
  const [old] = await pool.query('SELECT img FROM properties WHERE id = ?', [id]);
  if (!old.length) return false;
  await pool.query(
    `UPDATE properties SET title_zh=?, title_en=?, type=?, price_rm=?, area_sqft=?, beds_zh=?, beds_en=?, area=?,
       location_zh=?, location_en=?, address=?, img=?, status_zh=?, status_en=?, description_zh=?, description_en=?
     WHERE id = ?`,
    [...propertyValues(p), id]
  );
  if (old[0].img !== p.img) await removeIfOrphan(old[0].img);
  return true;
}

async function deleteProperty(id) {
  const [old] = await pool.query('SELECT img FROM properties WHERE id = ?', [id]);
  if (!old.length) return false;
  await pool.query('DELETE FROM properties WHERE id = ?', [id]);
  await removeIfOrphan(old[0].img);
  return true;
}

// ---------- team ----------
const teamValues = (t) => [t.name, t.role.zh, t.role.en, t.meta.zh, t.meta.en, t.img];

async function createTeamMember(t) {
  const [[{ next }]] = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM team');
  const [res] = await pool.query(
    'INSERT INTO team (name, role_zh, role_en, meta_zh, meta_en, img, sort_order) VALUES (?,?,?,?,?,?,?)',
    [...teamValues(t), next]
  );
  return res.insertId;
}

async function updateTeamMember(id, t) {
  const [old] = await pool.query('SELECT img FROM team WHERE id = ?', [id]);
  if (!old.length) return false;
  await pool.query('UPDATE team SET name=?, role_zh=?, role_en=?, meta_zh=?, meta_en=?, img=? WHERE id = ?', [...teamValues(t), id]);
  if (old[0].img !== t.img) await removeIfOrphan(old[0].img);
  return true;
}

async function deleteTeamMember(id) {
  const [old] = await pool.query('SELECT img FROM team WHERE id = ?', [id]);
  if (!old.length) return false;
  await pool.query('DELETE FROM team WHERE id = ?', [id]);
  await removeIfOrphan(old[0].img);
  return true;
}

// ---------- hero ----------
async function setHero(img) {
  const old = await getHero();
  await pool.query("INSERT INTO settings (`key`, `value`) VALUES ('hero_img', ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)", [img]);
  if (old !== img) await removeIfOrphan(old);
}

// ---------- admins ----------
// Every admin signs in with their own 6-digit passcode. The first admin is the "owner": the only one who can add,
// disable, rename or delete the others. The table is created automatically, and an existing single passcode from the
// old .env setup (ADMIN_PASSWORD_HASH) is moved into it as the owner, so nobody has to redo anything after an update.
let adminsReady = null;

function ensureAdmins() {
  if (adminsReady) return adminsReady;
  adminsReady = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS admins (
      id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name          VARCHAR(60)  NOT NULL,
      passcode_hash VARCHAR(100) NOT NULL,
      active        TINYINT(1)   NOT NULL DEFAULT 1,
      is_owner      TINYINT(1)   NOT NULL DEFAULT 0,
      last_login_at TIMESTAMP NULL DEFAULT NULL,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM admins');
    if (Number(n) === 0 && process.env.ADMIN_PASSWORD_HASH) {
      await pool.query('INSERT INTO admins (name, passcode_hash, active, is_owner) VALUES (?, ?, 1, 1)', ['Owner', process.env.ADMIN_PASSWORD_HASH]);
      console.log('✓ 已把 .env 里原来的后台密码迁移为「所有者」账号（Owner）');
    }
  })().catch((err) => { adminsReady = null; throw err; });
  return adminsReady;
}

const mapAdmin = (a) => ({
  id: a.id,
  name: a.name,
  active: !!a.active,
  owner: !!a.is_owner,
  lastLoginAt: a.last_login_at,
  createdAt: a.created_at,
});

async function listAdmins() {
  await ensureAdmins();
  const [rows] = await pool.query('SELECT * FROM admins ORDER BY is_owner DESC, id ASC');
  return rows.map(mapAdmin);
}

async function getAdmin(id) {
  await ensureAdmins();
  const [rows] = await pool.query('SELECT * FROM admins WHERE id = ?', [id]);
  return rows.length ? mapAdmin(rows[0]) : null;
}

// With password hashes: only for checking a sign-in / a passcode
async function getAdminsWithHash({ activeOnly = false } = {}) {
  await ensureAdmins();
  const [rows] = await pool.query(`SELECT * FROM admins ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY id ASC`);
  return rows.map((a) => ({ ...mapAdmin(a), hash: a.passcode_hash }));
}

async function createAdmin(name, hash) {
  await ensureAdmins();
  const [res] = await pool.query('INSERT INTO admins (name, passcode_hash) VALUES (?, ?)', [name, hash]);
  return res.insertId;
}

async function updateAdmin(id, fields) {
  await ensureAdmins();
  const sets = [];
  const vals = [];
  if (typeof fields.name === 'string') { sets.push('name = ?'); vals.push(fields.name); }
  if (typeof fields.active === 'boolean') { sets.push('active = ?'); vals.push(fields.active ? 1 : 0); }
  if (!sets.length) return true;
  const [res] = await pool.query(`UPDATE admins SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
  return res.affectedRows > 0;
}

async function setAdminPasscode(id, hash) {
  await ensureAdmins();
  const [res] = await pool.query('UPDATE admins SET passcode_hash = ? WHERE id = ?', [hash, id]);
  return res.affectedRows > 0;
}

async function deleteAdmin(id) {
  await ensureAdmins();
  const [res] = await pool.query('DELETE FROM admins WHERE id = ? AND is_owner = 0', [id]);
  return res.affectedRows > 0;
}

async function touchAdminLogin(id) {
  await pool.query('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [id]);
}

// Used by `npm run set-admin`: creates the owner, or replaces the owner's passcode
async function setOwnerPasscode(hash) {
  await ensureAdmins();
  const [rows] = await pool.query('SELECT id FROM admins WHERE is_owner = 1 LIMIT 1');
  if (rows.length) {
    await pool.query('UPDATE admins SET passcode_hash = ?, active = 1 WHERE id = ?', [hash, rows[0].id]);
    return 'updated';
  }
  await pool.query('INSERT INTO admins (name, passcode_hash, active, is_owner) VALUES (?, ?, 1, 1)', ['Owner', hash]);
  return 'created';
}

// ---------- first-time seed ----------
async function seedDefaults() {
  // Only ever fills an empty database (first-time setup). It never deletes existing content.
  const conn = await pool.getConnection();
  try {
    const [[{ n }]] = await conn.query('SELECT (SELECT COUNT(*) FROM properties) + (SELECT COUNT(*) FROM team) AS n');
    if (Number(n) > 0) return false;
    await conn.beginTransaction();
    for (const [i, p] of seedData.properties.entries()) {
      await conn.query(
        `INSERT INTO properties (title_zh, title_en, type, price_rm, area_sqft, beds_zh, beds_en, area,
           location_zh, location_en, address, img, status_zh, status_en, description_zh, description_en, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [p.title.zh, p.title.en, p.type, p.priceRM, p.areaSqft, p.beds.zh, p.beds.en, p.area, p.location.zh,
         p.location.en, p.address, p.img, p.status.zh, p.status.en, p.desc.zh, p.desc.en, i]
      );
    }
    for (const [i, t] of seedData.team.entries()) {
      await conn.query(
        'INSERT INTO team (name, role_zh, role_en, meta_zh, meta_en, img, sort_order) VALUES (?,?,?,?,?,?,?)',
        [t.name, t.role.zh, t.role.en, t.meta.zh, t.meta.en, t.img, i]
      );
    }
    await conn.query("INSERT INTO settings (`key`, `value`) VALUES ('hero_img', ?) ON DUPLICATE KEY UPDATE `value` = `value`", [seedData.hero.img]);
    await conn.commit();
    return true;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  UPLOAD_DIR, getContent, createProperty, updateProperty, deleteProperty,
  createTeamMember, updateTeamMember, deleteTeamMember, setHero, seedDefaults,
  ensureAdmins, listAdmins, getAdmin, getAdminsWithHash, createAdmin, updateAdmin, setAdminPasscode, deleteAdmin,
  touchAdminLogin, setOwnerPasscode,
};
