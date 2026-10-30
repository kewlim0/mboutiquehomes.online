// All SQL lives here. Rows are mapped to the same shape the front end already uses
// ({ title: { zh, en }, priceRM, ... }), and an empty English text falls back to the Chinese one.
const fs = require('fs');
const path = require('path');
const pool = require('./db');
const seedData = require('./seed-data');
const v = require('./validate');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

const pair = (zh, en) => ({ zh, en: en || zh });

// Public id used in shared links (/listing/k3v9x2m7qa): short, random, not guessable from the listing number
const CODE_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';
function newCode() {
  const bytes = require('crypto').randomBytes(10);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

function parseHighlights(text) {
  try {
    const list = JSON.parse(text || '[]');
    return Array.isArray(list) ? list.filter((h) => h && (h.zh || h.en)).map((h) => ({ ...(h.key ? { key: h.key } : {}), ...pair(h.zh || h.en, h.en) })) : [];
  } catch (e) { return []; }
}

// the four tags the site used to show on every listing: existing listings keep them when the column is first added
const DEFAULT_HIGHLIGHTS = [
  { zh: '无边际泳池', en: 'Infinity Pool' }, { zh: '高空健身房', en: 'Sky Gym' },
  { zh: '24小时安保', en: '24-hour Security' }, { zh: '直通 MRT 车站', en: 'Direct MRT Access' },
];

function mapProperty(r, photos) {
  // Bedrooms / bathrooms come from the two dropdowns; older rows that could not be read keep their stored text
  const structured = r.bedrooms && r.bathrooms ? v.bedsText(r.bedrooms, r.bathrooms) : null;
  return {
    id: r.id,
    code: r.code || null,
    title: pair(r.title_zh, r.title_en),
    type: r.type,
    priceRM: Number(r.price_rm),
    isRentPrice: r.type === 'rent',
    areaSqft: r.area_sqft,
    beds: structured ? pair(structured.zh, structured.en) : pair(r.beds_zh, r.beds_en),
    bedrooms: r.bedrooms || null,
    bathrooms: r.bathrooms || null,
    area: r.area,
    location: pair(r.location_zh, r.location_en),
    address: r.address,
    highlights: parseHighlights(r.highlights),
    closed: !!r.is_closed,   // sold (sale) / rented (rent): shown as such on the site
    availableFrom: r.available_from_str || null,   // 'YYYY-MM-DD': the home can be moved into from this day (shown while it is still in the future)
    img: r.img,
    photos: photos && photos.length ? photos : [r.img],
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

// Extra pictures per listing. The table is created on first use, so an existing database upgrades by itself.
let photosReady = null;

function ensurePropertyPhotos() {
  if (photosReady) return photosReady;
  photosReady = pool.query(`CREATE TABLE IF NOT EXISTS property_photos (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    property_id INT UNSIGNED NOT NULL,
    img         VARCHAR(600) NOT NULL,
    sort_order  INT NOT NULL DEFAULT 0,
    KEY idx_property_photos (property_id, sort_order),
    CONSTRAINT fk_property_photos_property FOREIGN KEY (property_id) REFERENCES properties (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch((err) => { photosReady = null; throw err; });
  return photosReady;
}

async function photosByProperty() {
  await ensurePropertyPhotos();
  const [rows] = await pool.query('SELECT property_id, img FROM property_photos ORDER BY property_id, sort_order, id');
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.property_id)) map.set(row.property_id, []);
    map.get(row.property_id).push(row.img);
  }
  return map;
}

// Adds the bedrooms / bathrooms columns to an existing database and fills them from the old "3 房 2 卫" text.
let propertyColsReady = null;

function ensurePropertyColumns() {
  if (propertyColsReady) return propertyColsReady;
  propertyColsReady = (async () => {
    const [cols] = await pool.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'properties'"
    );
    if (!cols.length) throw new Error('properties table does not exist yet (run npm run db:init)');
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    if (!have.has('bedrooms')) await pool.query('ALTER TABLE properties ADD COLUMN bedrooms VARCHAR(10) NULL AFTER beds_en');
    if (!have.has('bathrooms')) await pool.query('ALTER TABLE properties ADD COLUMN bathrooms VARCHAR(10) NULL AFTER bedrooms');
    if (!have.has('code')) {
      await pool.query('ALTER TABLE properties ADD COLUMN code VARCHAR(16) NULL');
      await pool.query('ALTER TABLE properties ADD UNIQUE KEY uq_properties_code (code)');
    }
    if (!have.has('highlights')) {
      await pool.query('ALTER TABLE properties ADD COLUMN highlights TEXT NULL');
      await pool.query('UPDATE properties SET highlights = ?', [JSON.stringify(DEFAULT_HIGHLIGHTS)]);
    }
    if (!have.has('is_closed')) await pool.query('ALTER TABLE properties ADD COLUMN is_closed TINYINT(1) NOT NULL DEFAULT 0');
    if (!have.has('available_from')) await pool.query('ALTER TABLE properties ADD COLUMN available_from DATE NULL');
    // the owner's phone number: admin-only, never part of mapProperty() / the public content
    if (!have.has('owner_phone')) await pool.query("ALTER TABLE properties ADD COLUMN owner_phone VARCHAR(30) NOT NULL DEFAULT ''");
    await pool.query("UPDATE properties SET area = 'Outskirt' WHERE area = 'Suburb'");
    const [missing] = await pool.query('SELECT id FROM properties WHERE code IS NULL');
    for (const row of missing) await pool.query('UPDATE properties SET code = ? WHERE id = ?', [newCode(), row.id]);
    const [rows] = await pool.query('SELECT id, beds_zh FROM properties WHERE bedrooms IS NULL OR bathrooms IS NULL');
    for (const row of rows) {
      const parsed = v.parseBeds(row.beds_zh);
      if (parsed) await pool.query('UPDATE properties SET bedrooms = ?, bathrooms = ? WHERE id = ?', [parsed.bedrooms, parsed.bathrooms, row.id]);
    }
  })().catch((err) => { propertyColsReady = null; throw err; });
  return propertyColsReady;
}

async function getHero() {
  const [rows] = await pool.query("SELECT `value` FROM settings WHERE `key` = 'hero_img'");
  return rows.length ? rows[0].value : seedData.hero.img;
}

// One listing (used for the link preview of a shared listing)
async function getPropertyById(id) { return getOneProperty('id', id); }
async function getPropertyByCode(code) { return getOneProperty('code', code); }

async function getOneProperty(column, value) {
  await ensurePropertyColumns();
  await ensurePropertyPhotos();
  const [rows] = await pool.query(`SELECT *, DATE_FORMAT(available_from, '%Y-%m-%d') AS available_from_str FROM properties WHERE ${column === 'code' ? 'code' : 'id'} = ?`, [value]);
  if (!rows.length) return null;
  const id = rows[0].id;
  const [photos] = await pool.query('SELECT img FROM property_photos WHERE property_id = ? ORDER BY sort_order, id', [id]);
  return mapProperty(rows[0], photos.map((p) => p.img));
}

async function getContent() {
  await ensurePropertyColumns();
  const [props] = await pool.query("SELECT *, DATE_FORMAT(available_from, '%Y-%m-%d') AS available_from_str FROM properties ORDER BY sort_order ASC, id DESC");
  const photoMap = await photosByProperty();
  const [team] = await pool.query('SELECT * FROM team ORDER BY sort_order ASC, id ASC');
  // `img` is the default banner; `banners` are the active scheduled ones (the page picks one by date and day/night)
  const banners = (await listHeroBanners()).filter((b) => b.active);
  return { hero: { img: await getHero(), banners }, properties: props.map((p) => mapProperty(p, photoMap.get(p.id))), team: team.map(mapTeam) };
}

// ---------- uploaded-file cleanup ----------
// Remove an uploaded file once nothing in the database points to it any more.
async function removeIfOrphan(imgPath) {
  if (!/^uploads\/[a-f0-9]+\.(jpg|png|webp|gif)$/.test(imgPath || '')) return;
  await ensureHeroBanners();
  await ensurePropertyPhotos();
  const [rows] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM properties WHERE img = ?)
          + (SELECT COUNT(*) FROM property_photos WHERE img = ?)
          + (SELECT COUNT(*) FROM team WHERE img = ?)
          + (SELECT COUNT(*) FROM hero_banners WHERE img = ?)
          + (SELECT COUNT(*) FROM settings WHERE \`value\` = ?) AS n`,
    [imgPath, imgPath, imgPath, imgPath, imgPath]
  );
  if (Number(rows[0].n) === 0) {
    fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(imgPath))).catch(() => {});
  }
}

// ---------- properties ----------
const propertyValues = (p) => [
  p.title.zh, p.title.en, p.type, p.priceRM, p.areaSqft, p.beds.zh, p.beds.en, p.bedrooms || null, p.bathrooms || null, p.area,
  p.location.zh, p.location.en, p.address, p.img, p.status.zh, p.status.en, p.desc.zh, p.desc.en,
];

// highlight tags and the sold / rented flag; a field the client did not send stays as it is
async function writeExtras(conn, id, p) {
  if (p.highlights !== undefined) await conn.query('UPDATE properties SET highlights = ? WHERE id = ?', [JSON.stringify(p.highlights), id]);
  if (p.closed !== undefined) await conn.query('UPDATE properties SET is_closed = ? WHERE id = ?', [p.closed ? 1 : 0, id]);
  if (p.availableFrom !== undefined) await conn.query('UPDATE properties SET available_from = ? WHERE id = ?', [p.availableFrom, id]);
  if (p.ownerPhone !== undefined) await conn.query('UPDATE properties SET owner_phone = ? WHERE id = ?', [p.ownerPhone, id]);
}

// { listingId: phone } for the dashboard only (route is behind requireAdmin)
async function getOwnerPhones() {
  const [rows] = await pool.query("SELECT id, owner_phone FROM properties WHERE owner_phone <> ''");
  return Object.fromEntries(rows.map((r) => [r.id, r.owner_phone]));
}

async function writePhotos(conn, propertyId, photos) {
  await conn.query('DELETE FROM property_photos WHERE property_id = ?', [propertyId]);
  for (const [i, img] of photos.entries()) {
    await conn.query('INSERT INTO property_photos (property_id, img, sort_order) VALUES (?, ?, ?)', [propertyId, img, i]);
  }
}

async function createProperty(p) {
  await ensurePropertyColumns();
  await ensurePropertyPhotos();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // New listings go to the top of the list
    const [[{ top }]] = await conn.query('SELECT COALESCE(MIN(sort_order), 0) - 1 AS top FROM properties');
    const [res] = await conn.query(
      `INSERT INTO properties (title_zh, title_en, type, price_rm, area_sqft, beds_zh, beds_en, bedrooms, bathrooms, area,
         location_zh, location_en, address, img, status_zh, status_en, description_zh, description_en, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [...propertyValues(p), top]
    );
    await conn.query('UPDATE properties SET code = ? WHERE id = ?', [newCode(), res.insertId]);
    await writeExtras(conn, res.insertId, p);
    await writePhotos(conn, res.insertId, p.photos);
    await conn.commit();
    return res.insertId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function updateProperty(id, p) {
  await ensurePropertyColumns();
  await ensurePropertyPhotos();
  const [old] = await pool.query('SELECT img FROM properties WHERE id = ?', [id]);
  if (!old.length) return false;
  const [oldPhotos] = await pool.query('SELECT img FROM property_photos WHERE property_id = ?', [id]);
  const before = new Set([old[0].img, ...oldPhotos.map((x) => x.img)]);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE properties SET title_zh=?, title_en=?, type=?, price_rm=?, area_sqft=?, beds_zh=?, beds_en=?, bedrooms=?, bathrooms=?, area=?,
         location_zh=?, location_en=?, address=?, img=?, status_zh=?, status_en=?, description_zh=?, description_en=?
       WHERE id = ?`,
      [...propertyValues(p), id]
    );
    await writeExtras(conn, id, p);
    await writePhotos(conn, id, p.photos);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  // delete the files of pictures that were taken out of the listing (when nothing else uses them)
  for (const img of before) if (!p.photos.includes(img)) await removeIfOrphan(img);
  return true;
}

// New display order of the listings: `ids` first (in that order), any listing that is not named keeps its place after them.
async function setPropertyOrder(ids) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT id FROM properties ORDER BY sort_order ASC, id DESC FOR UPDATE');
    const existing = rows.map((r) => r.id);
    const named = ids.filter((id) => existing.includes(id));
    const rest = existing.filter((id) => !named.includes(id));
    const order = [...named, ...rest];
    for (const [i, id] of order.entries()) await conn.query('UPDATE properties SET sort_order = ? WHERE id = ?', [i, id]);
    await conn.commit();
    return order;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteProperty(id) {
  await ensurePropertyPhotos();
  const [old] = await pool.query('SELECT img FROM properties WHERE id = ?', [id]);
  if (!old.length) return false;
  const [photos] = await pool.query('SELECT img FROM property_photos WHERE property_id = ?', [id]);
  const files = new Set([old[0].img, ...photos.map((x) => x.img)]);
  await pool.query('DELETE FROM properties WHERE id = ?', [id]); // the photo rows go with it (ON DELETE CASCADE)
  for (const img of files) await removeIfOrphan(img);
  return true;
}

// ---------- team ----------
const teamValues = (t) => [t.name, t.role.zh, t.role.en, t.meta.zh, t.meta.en, t.img];

// ---------- SIM / phone lines (/tracker/) ----------
let simsReady = null;
function ensureSims() {
  if (!simsReady) {
    simsReady = pool.query(`CREATE TABLE IF NOT EXISTS sims (
      id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      phone      VARCHAR(40)  NOT NULL,
      telco      VARCHAR(30)  NOT NULL,
      alias      VARCHAR(120) NOT NULL,
      exp_date   DATE         NOT NULL,
      tag        VARCHAR(30)  NOT NULL DEFAULT 'Personal',
      notes      VARCHAR(1000) NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_sims_exp (exp_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).then(async () => {
      // last top-up date; the expiry (exp_date) is always top-up + 59 days (60 days counting the top-up day).
      const [cols] = await pool.query("SHOW COLUMNS FROM sims LIKE 'topup_date'");
      if (!cols.length) await pool.query('ALTER TABLE sims ADD COLUMN topup_date DATE NULL AFTER exp_date');
      const [wa] = await pool.query("SHOW COLUMNS FROM sims LIKE 'whatsapp'");
      if (!wa.length) await pool.query("ALTER TABLE sims ADD COLUMN whatsapp VARCHAR(10) NOT NULL DEFAULT 'inactive' AFTER topup_date");
      await pool.query('UPDATE sims SET topup_date = DATE_SUB(exp_date, INTERVAL 59 DAY) WHERE topup_date IS NULL');
      // lines saved while the rule was "top-up + 60 days" move to the final rule (top-up day counts as day 1: + 59)
      await pool.query('UPDATE sims SET exp_date = DATE_ADD(topup_date, INTERVAL 59 DAY) WHERE DATEDIFF(exp_date, topup_date) = 60');
    }).catch((err) => { simsReady = null; throw err; });
  }
  return simsReady;
}

const SIM_COLUMNS = "id, phone, telco, alias, DATE_FORMAT(exp_date, '%Y-%m-%d') AS expDate, DATE_FORMAT(topup_date, '%Y-%m-%d') AS topupDate, whatsapp, tag, notes";

async function listSims() {
  await ensureSims();
  const [rows] = await pool.query(`SELECT ${SIM_COLUMNS} FROM sims ORDER BY exp_date ASC, id ASC`);
  return rows;
}

async function createSim(s) {
  await ensureSims();
  const [res] = await pool.query(
    'INSERT INTO sims (phone, telco, alias, topup_date, exp_date, whatsapp, tag, notes) VALUES (?,?,?,?,?,?,?,?)',
    [s.phone, s.telco, s.alias, s.topupDate, s.expDate, s.whatsapp, s.tag, s.notes]
  );
  const [[row]] = await pool.query(`SELECT ${SIM_COLUMNS} FROM sims WHERE id = ?`, [res.insertId]);
  return row;
}

async function updateSim(id, s) {
  await ensureSims();
  const [res] = await pool.query(
    'UPDATE sims SET phone=?, telco=?, alias=?, topup_date=?, exp_date=?, whatsapp=?, tag=?, notes=? WHERE id = ?',
    [s.phone, s.telco, s.alias, s.topupDate, s.expDate, s.whatsapp, s.tag, s.notes, id]
  );
  if (!res.affectedRows) {
    const [[exists]] = await pool.query('SELECT COUNT(*) AS n FROM sims WHERE id = ?', [id]);
    if (!exists.n) return null;
  }
  const [[row]] = await pool.query(`SELECT ${SIM_COLUMNS} FROM sims WHERE id = ?`, [id]);
  return row;
}

async function deleteSim(id) {
  await ensureSims();
  const [res] = await pool.query('DELETE FROM sims WHERE id = ?', [id]);
  return res.affectedRows > 0;
}

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

// ---------- scheduled hero banners ----------
let bannersReady = null;

function ensureHeroBanners() {
  if (bannersReady) return bannersReady;
  bannersReady = pool.query(`CREATE TABLE IF NOT EXISTS hero_banners (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    title      VARCHAR(80)  NOT NULL DEFAULT '',
    img        VARCHAR(600) NOT NULL,
    slot       ENUM('all','day','night') NOT NULL DEFAULT 'all',
    start_date DATE NULL DEFAULT NULL,
    end_date   DATE NULL DEFAULT NULL,
    active     TINYINT(1)   NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch((err) => { bannersReady = null; throw err; });
  return bannersReady;
}

// Dates are returned as plain 'YYYY-MM-DD' strings (no time zone shifting)
const mapBanner = (b) => ({
  id: b.id,
  title: b.title,
  img: b.img,
  slot: b.slot,
  startDate: b.start_date,
  endDate: b.end_date,
  active: !!b.active,
});

async function listHeroBanners() {
  await ensureHeroBanners();
  const [rows] = await pool.query(
    `SELECT id, title, img, slot, active,
            DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date
       FROM hero_banners ORDER BY id DESC`
  );
  return rows.map(mapBanner);
}

async function createHeroBanner(b) {
  await ensureHeroBanners();
  const [res] = await pool.query(
    'INSERT INTO hero_banners (title, img, slot, start_date, end_date, active) VALUES (?, ?, ?, ?, ?, ?)',
    [b.title, b.img, b.slot, b.startDate, b.endDate, b.active ? 1 : 0]
  );
  return res.insertId;
}

async function updateHeroBanner(id, b) {
  await ensureHeroBanners();
  const [old] = await pool.query('SELECT img FROM hero_banners WHERE id = ?', [id]);
  if (!old.length) return false;
  await pool.query(
    'UPDATE hero_banners SET title = ?, img = ?, slot = ?, start_date = ?, end_date = ?, active = ? WHERE id = ?',
    [b.title, b.img, b.slot, b.startDate, b.endDate, b.active ? 1 : 0, id]
  );
  if (old[0].img !== b.img) await removeIfOrphan(old[0].img);
  return true;
}

async function deleteHeroBanner(id) {
  await ensureHeroBanners();
  const [old] = await pool.query('SELECT img FROM hero_banners WHERE id = ?', [id]);
  if (!old.length) return false;
  await pool.query('DELETE FROM hero_banners WHERE id = ?', [id]);
  await removeIfOrphan(old[0].img);
  return true;
}

// ---------- first-time seed ----------
async function seedDefaults() {
  await ensurePropertyColumns();
  // Only ever fills an empty database (first-time setup). It never deletes existing content.
  const conn = await pool.getConnection();
  try {
    const [[{ n }]] = await conn.query('SELECT (SELECT COUNT(*) FROM properties) + (SELECT COUNT(*) FROM team) AS n');
    if (Number(n) > 0) return false;
    await conn.beginTransaction();
    for (const [i, p] of seedData.properties.entries()) {
      await conn.query(
        `INSERT INTO properties (title_zh, title_en, type, price_rm, area_sqft, beds_zh, beds_en, bedrooms, bathrooms, area,
           location_zh, location_en, address, img, status_zh, status_en, description_zh, description_en, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [p.title.zh, p.title.en, p.type, p.priceRM, p.areaSqft, p.beds.zh, p.beds.en, p.bedrooms || null, p.bathrooms || null, p.area, p.location.zh,
         p.location.en, p.address, p.img, p.status.zh, p.status.en, p.desc.zh, p.desc.en, i]
      );
    }
    await conn.query('UPDATE properties SET highlights = ?', [JSON.stringify(DEFAULT_HIGHLIGHTS)]);
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
  UPLOAD_DIR, getOwnerPhones, getContent, getPropertyById, getPropertyByCode, setPropertyOrder, ensureSims, listSims, createSim, updateSim, deleteSim, createProperty, updateProperty, deleteProperty,
  createTeamMember, updateTeamMember, deleteTeamMember, setHero, seedDefaults,
  ensureAdmins, listAdmins, getAdmin, getAdminsWithHash, createAdmin, updateAdmin, setAdminPasscode, deleteAdmin,
  touchAdminLogin, setOwnerPasscode,
  ensurePropertyColumns, ensurePropertyPhotos, ensureHeroBanners, listHeroBanners, createHeroBanner, updateHeroBanner, deleteHeroBanner,
};
