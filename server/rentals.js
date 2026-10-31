// Rental units, tenants and the monthly bills (the /tracker/bill/ and /tracker/tenants/ pages).
// Everything here sits behind the admin sign-in; none of it is part of the public site content.
const pool = require('./db');
const { HttpError } = require('./validate');

// ---------- tables ----------
let ready = null;
function ensureRentals() {
  if (!ready) {
    ready = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS rental_units (
        id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name         VARCHAR(120) NOT NULL,
        client_name  VARCHAR(160) NOT NULL DEFAULT '',
        tnb_no       VARCHAR(160) NOT NULL DEFAULT '',
        wifi_no      VARCHAR(160) NOT NULL DEFAULT '',
        water_no     VARCHAR(160) NOT NULL DEFAULT '',
        syabas_no    VARCHAR(160) NOT NULL DEFAULT '',
        rent_rm      DECIMAL(12,2) NULL,
        rent_mode    VARCHAR(80)  NOT NULL DEFAULT '',
        rent_due     VARCHAR(500) NOT NULL DEFAULT '',
        rental_start DATE NULL,
        rental_end   DATE NULL,
        owner_acc    TEXT NULL,
        notes        TEXT NULL,
        sort_order   INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await pool.query(`CREATE TABLE IF NOT EXISTS rental_tenants (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        unit_id    INT UNSIGNED NULL,
        name       VARCHAR(160) NOT NULL,
        full_name  VARCHAR(160) NOT NULL DEFAULT '',
        passport   VARCHAR(60)  NOT NULL DEFAULT '',
        email      VARCHAR(160) NOT NULL DEFAULT '',
        phone      VARCHAR(40)  NOT NULL DEFAULT '',
        notes      TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_tenants_unit (unit_id),
        CONSTRAINT fk_tenants_unit FOREIGN KEY (unit_id) REFERENCES rental_units(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await pool.query(`CREATE TABLE IF NOT EXISTS rental_bills (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        unit_id    INT UNSIGNED NOT NULL,
        bill_date  DATE NOT NULL,
        received   TINYINT(1) NOT NULL DEFAULT 0,
        notes      VARCHAR(1000) NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_bills_unit_date (unit_id, bill_date),
        CONSTRAINT fk_bills_unit FOREIGN KEY (unit_id) REFERENCES rental_units(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await pool.query(`CREATE TABLE IF NOT EXISTS rental_bill_items (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        bill_id    INT UNSIGNED NOT NULL,
        category   VARCHAR(10)  NOT NULL DEFAULT 'misc',
        name       VARCHAR(160) NOT NULL,
        detail     VARCHAR(300) NOT NULL DEFAULT '',
        amount     DECIMAL(12,2) NULL,
        status     VARCHAR(10)  NOT NULL DEFAULT 'pending',
        link       VARCHAR(600) NOT NULL DEFAULT '',
        note       VARCHAR(500) NOT NULL DEFAULT '',
        sort_order INT NOT NULL DEFAULT 0,
        KEY idx_items_bill (bill_id),
        CONSTRAINT fk_items_bill FOREIGN KEY (bill_id) REFERENCES rental_bills(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

// ---------- validation ----------
const CATEGORIES = ['utility', 'rent', 'misc', 'stamp'];
const STATUSES = ['pending', 'paid', 'unpaid'];

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
const moneyOrNull = (value, label) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < -100000000 || n > 100000000) throw new HttpError(400, `${label}无效`);
  return Math.round(n * 100) / 100;
};
const id = (value, label) => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `${label}无效`);
  return n;
};

function unit(body) {
  const b = body && typeof body === 'object' ? body : {};
  return {
    name: text(b.name, '单位名称', 120, { required: true }),
    clientName: text(b.clientName, '客户名称', 160),
    tnbNo: text(b.tnbNo, 'TNB 电费号码', 160),
    wifiNo: text(b.wifiNo, 'WiFi 宽带号码', 160),
    waterNo: text(b.waterNo, 'Indah Water 污水号码', 160),
    syabasNo: text(b.syabasNo, 'Syabas 水费号码', 160),
    rentRm: moneyOrNull(b.rentRm, '月租'),
    rentMode: text(b.rentMode, '付租方式', 80),
    rentDue: text(b.rentDue, '收租日', 500),
    rentalStart: dateOrNull(b.rentalStart, '租期开始'),
    rentalEnd: dateOrNull(b.rentalEnd, '租期结束'),
    ownerAcc: text(b.ownerAcc, '屋主户口', 4000),
    notes: text(b.notes, '备注', 4000),
  };
}

function tenant(body) {
  const b = body && typeof body === 'object' ? body : {};
  const email = text(b.email, '邮箱', 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, '邮箱格式不对');
  return {
    unitId: id(b.unitId, '单位'),
    name: text(b.name, '租客名称', 160, { required: true }),
    fullName: text(b.fullName, '证件上的全名', 160),
    passport: text(b.passport, '护照号码', 60),
    email,
    phone: text(b.phone, '电话', 40),
    notes: text(b.notes, '备注', 4000),
  };
}

function bill(body) {
  const b = body && typeof body === 'object' ? body : {};
  const items = Array.isArray(b.items) ? b.items : [];
  if (items.length > 200) throw new HttpError(400, '一张账单最多 200 个项目');
  return {
    unitId: id(b.unitId, '单位'),
    billDate: dateOrNull(b.billDate, '账单日期') || (() => { throw new HttpError(400, '账单日期不能为空'); })(),
    received: b.received === true,
    notes: text(b.notes, '备注', 1000),
    items: items.map((it, i) => {
      const o = it && typeof it === 'object' ? it : {};
      const link = text(o.link, '单据链接', 600);
      if (link && !/^https?:\/\/[^\s"'<>]+$/.test(link)) throw new HttpError(400, '单据链接必须是 http(s) 网址');
      return {
        category: CATEGORIES.includes(o.category) ? o.category : 'misc',
        name: text(o.name, '项目名称', 160, { required: true }),
        detail: text(o.detail, '费用说明', 300),
        amount: moneyOrNull(o.amount, '金额'),
        status: STATUSES.includes(o.status) ? o.status : 'pending',
        link,
        note: text(o.note, '项目备注', 500),
        sortOrder: i,
      };
    }),
  };
}

// ---------- row mapping ----------
const ymd = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : d || null);
const num = (x) => (x === null || x === undefined ? null : Number(x));

const mapUnit = (r) => ({
  id: r.id, name: r.name, clientName: r.client_name, tnbNo: r.tnb_no, wifiNo: r.wifi_no, waterNo: r.water_no, syabasNo: r.syabas_no,
  rentRm: num(r.rent_rm), rentMode: r.rent_mode, rentDue: r.rent_due, rentalStart: ymd(r.rental_start), rentalEnd: ymd(r.rental_end),
  ownerAcc: r.owner_acc || '', notes: r.notes || '',
});
const mapTenant = (r) => ({
  id: r.id, unitId: r.unit_id, name: r.name, fullName: r.full_name, passport: r.passport, email: r.email, phone: r.phone, notes: r.notes || '',
});
const mapItem = (r) => ({
  id: r.id, category: r.category, name: r.name, detail: r.detail, amount: num(r.amount), status: r.status, link: r.link, note: r.note,
});

// ---------- queries ----------
async function listAll() {
  await ensureRentals();
  const [units] = await pool.query('SELECT * FROM rental_units ORDER BY sort_order ASC, id ASC');
  const [tenants] = await pool.query('SELECT * FROM rental_tenants ORDER BY id ASC');
  const [bills] = await pool.query("SELECT id, unit_id, DATE_FORMAT(bill_date, '%Y-%m-%d') AS bill_date, received, notes FROM rental_bills ORDER BY bill_date DESC, id DESC");
  const [items] = await pool.query('SELECT * FROM rental_bill_items ORDER BY bill_id ASC, sort_order ASC, id ASC');
  const byBill = new Map();
  for (const it of items) { if (!byBill.has(it.bill_id)) byBill.set(it.bill_id, []); byBill.get(it.bill_id).push(mapItem(it)); }
  return {
    units: units.map(mapUnit),
    tenants: tenants.map(mapTenant),
    bills: bills.map((b) => ({ id: b.id, unitId: b.unit_id, billDate: b.bill_date, received: !!b.received, notes: b.notes, items: byBill.get(b.id) || [] })),
  };
}

async function oneUnit(unitId) { const [[r]] = await pool.query('SELECT * FROM rental_units WHERE id = ?', [unitId]); return r ? mapUnit(r) : null; }
async function oneTenant(tid) { const [[r]] = await pool.query('SELECT * FROM rental_tenants WHERE id = ?', [tid]); return r ? mapTenant(r) : null; }
async function oneBill(bid) {
  const [[b]] = await pool.query("SELECT id, unit_id, DATE_FORMAT(bill_date, '%Y-%m-%d') AS bill_date, received, notes FROM rental_bills WHERE id = ?", [bid]);
  if (!b) return null;
  const [items] = await pool.query('SELECT * FROM rental_bill_items WHERE bill_id = ? ORDER BY sort_order ASC, id ASC', [bid]);
  return { id: b.id, unitId: b.unit_id, billDate: b.bill_date, received: !!b.received, notes: b.notes, items: items.map(mapItem) };
}

const unitValues = (u) => [u.name, u.clientName, u.tnbNo, u.wifiNo, u.waterNo, u.syabasNo, u.rentRm, u.rentMode, u.rentDue, u.rentalStart, u.rentalEnd, u.ownerAcc, u.notes];
const UNIT_COLS = 'name, client_name, tnb_no, wifi_no, water_no, syabas_no, rent_rm, rent_mode, rent_due, rental_start, rental_end, owner_acc, notes';

async function createUnit(u) {
  await ensureRentals();
  const [[m]] = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM rental_units');
  const [res] = await pool.query(`INSERT INTO rental_units (${UNIT_COLS}, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [...unitValues(u), m.n]);
  return oneUnit(res.insertId);
}
async function updateUnit(unitId, u) {
  await ensureRentals();
  await pool.query(`UPDATE rental_units SET ${UNIT_COLS.split(', ').map((c) => `${c}=?`).join(', ')} WHERE id = ?`, [...unitValues(u), unitId]);
  return oneUnit(unitId);
}
async function deleteUnit(unitId) { await ensureRentals(); const [res] = await pool.query('DELETE FROM rental_units WHERE id = ?', [unitId]); return res.affectedRows > 0; }

const tenantValues = (t) => [t.unitId, t.name, t.fullName, t.passport, t.email, t.phone, t.notes];
async function createTenant(t) {
  await ensureRentals();
  await assertUnit(t.unitId);
  const [res] = await pool.query('INSERT INTO rental_tenants (unit_id, name, full_name, passport, email, phone, notes) VALUES (?,?,?,?,?,?,?)', tenantValues(t));
  return oneTenant(res.insertId);
}
async function updateTenant(tid, t) {
  await ensureRentals();
  await assertUnit(t.unitId);
  await pool.query('UPDATE rental_tenants SET unit_id=?, name=?, full_name=?, passport=?, email=?, phone=?, notes=? WHERE id = ?', [...tenantValues(t), tid]);
  return oneTenant(tid);
}
async function deleteTenant(tid) { await ensureRentals(); const [res] = await pool.query('DELETE FROM rental_tenants WHERE id = ?', [tid]); return res.affectedRows > 0; }

async function assertUnit(unitId) {
  if (unitId == null) return;
  const [[r]] = await pool.query('SELECT id FROM rental_units WHERE id = ?', [unitId]);
  if (!r) throw new HttpError(400, '找不到这个单位');
}

async function writeItems(conn, billId, items) {
  await conn.query('DELETE FROM rental_bill_items WHERE bill_id = ?', [billId]);
  for (const it of items) {
    await conn.query(
      'INSERT INTO rental_bill_items (bill_id, category, name, detail, amount, status, link, note, sort_order) VALUES (?,?,?,?,?,?,?,?,?)',
      [billId, it.category, it.name, it.detail, it.amount, it.status, it.link, it.note, it.sortOrder]
    );
  }
}
async function withTx(fn) {
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); const out = await fn(conn); await conn.commit(); return out; }
  catch (err) { await conn.rollback(); throw err; }
  finally { conn.release(); }
}

async function createBill(b) {
  await ensureRentals();
  if (b.unitId == null) throw new HttpError(400, '请选择单位');
  await assertUnit(b.unitId);
  const newId = await withTx(async (conn) => {
    const [res] = await conn.query('INSERT INTO rental_bills (unit_id, bill_date, received, notes) VALUES (?,?,?,?)', [b.unitId, b.billDate, b.received ? 1 : 0, b.notes]);
    await writeItems(conn, res.insertId, b.items);
    return res.insertId;
  });
  return oneBill(newId);
}
async function updateBill(bid, b) {
  await ensureRentals();
  if (!(await oneBill(bid))) return null;
  if (b.unitId != null) await assertUnit(b.unitId);
  await withTx(async (conn) => {
    await conn.query('UPDATE rental_bills SET bill_date=?, received=?, notes=?' + (b.unitId != null ? ', unit_id=?' : '') + ' WHERE id = ?',
      b.unitId != null ? [b.billDate, b.received ? 1 : 0, b.notes, b.unitId, bid] : [b.billDate, b.received ? 1 : 0, b.notes, bid]);
    await writeItems(conn, bid, b.items);
  });
  return oneBill(bid);
}
async function deleteBill(bid) { await ensureRentals(); const [res] = await pool.query('DELETE FROM rental_bills WHERE id = ?', [bid]); return res.affectedRows > 0; }

// quick toggle from the list: only the status of one item
async function setItemStatus(itemId, status) {
  await ensureRentals();
  if (!STATUSES.includes(status)) throw new HttpError(400, '状态无效');
  const [res] = await pool.query('UPDATE rental_bill_items SET status = ? WHERE id = ?', [status, itemId]);
  if (!res.affectedRows) {
    const [[r]] = await pool.query('SELECT id FROM rental_bill_items WHERE id = ?', [itemId]);
    if (!r) return null;
  }
  const [[row]] = await pool.query('SELECT bill_id FROM rental_bill_items WHERE id = ?', [itemId]);
  return oneBill(row.bill_id);
}
async function setBillReceived(bid, received) {
  await ensureRentals();
  await pool.query('UPDATE rental_bills SET received = ? WHERE id = ?', [received ? 1 : 0, bid]);
  return oneBill(bid);
}

// one-off import (scripts/import-rentals.js): replaces nothing, only adds
async function importAll(data) {
  await ensureRentals();
  const unitIds = new Map();
  return withTx(async (conn) => {
    let nu = 0, nt = 0, nb = 0, ni = 0;
    for (const raw of data.units || []) {
      const u = unit(raw);
      const [[m]] = await conn.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM rental_units');
      const [res] = await conn.query(`INSERT INTO rental_units (${UNIT_COLS}, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [...unitValues(u), m.n]);
      unitIds.set(raw.key || u.name, res.insertId); nu++;
    }
    for (const raw of data.tenants || []) {
      const t = tenant({ ...raw, unitId: raw.unitKey ? unitIds.get(raw.unitKey) : null });
      await conn.query('INSERT INTO rental_tenants (unit_id, name, full_name, passport, email, phone, notes) VALUES (?,?,?,?,?,?,?)', tenantValues(t)); nt++;
    }
    for (const raw of data.bills || []) {
      const b = bill({ ...raw, unitId: unitIds.get(raw.unitKey) });
      if (b.unitId == null) throw new HttpError(400, `找不到单位 ${raw.unitKey}`);
      const [res] = await conn.query('INSERT INTO rental_bills (unit_id, bill_date, received, notes) VALUES (?,?,?,?)', [b.unitId, b.billDate, b.received ? 1 : 0, b.notes]);
      await writeItems(conn, res.insertId, b.items); nb++; ni += b.items.length;
    }
    return { units: nu, tenants: nt, bills: nb, items: ni };
  });
}

module.exports = {
  ensureRentals, listAll, unit, tenant, bill,
  createUnit, updateUnit, deleteUnit, createTenant, updateTenant, deleteTenant,
  createBill, updateBill, deleteBill, setItemStatus, setBillReceived, importAll,
};
