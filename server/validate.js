// Small input validation helpers. Anything invalid throws an HttpError that the API turns into a 400 response.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const AREAS = ['KLCC', 'Mont Kiara', 'TRX', 'Bangsar', 'Outskirt', 'Bukit Tunku', 'Damansara Heights', 'Seputeh'];

function str(value, label, max, { required = false } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (required && !v) throw new HttpError(400, `${label}不能为空`);
  if (v.length > max) throw new HttpError(400, `${label}太长（最多 ${max} 个字符）`);
  return v;
}

function int(value, label, { min = 0, max = 2147483647 } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label}必须是 ${min} 到 ${max} 之间的整数`);
  return n;
}

// Images: a file shipped with the site (img/...), an admin upload (uploads/...) or an https/http link.
function image(value, label = '图片') {
  const v = str(value, label, 600, { required: true });
  if (!/^(https?:\/\/[^\s"'<>]+|(img|uploads)\/[\w./-]+)$/.test(v) || v.includes('..')) {
    throw new HttpError(400, `${label}地址无效`);
  }
  return v;
}

function bilingual(obj, label, max, { required = false } = {}) {
  const o = obj && typeof obj === 'object' ? obj : {};
  const zh = str(o.zh, `${label}（中文）`, max, { required });
  const en = str(o.en, `${label}（英文）`, max);
  return { zh, en };
}

// Bedrooms / bathrooms are picked from dropdowns; the Chinese and English texts are generated from them.
const BEDROOMS = ['studio', '1', '2', '3', '3+1', '4', '4+1', '5', '5+1', '6', '7+'];
const BATHROOMS = ['1', '2', '3', '4', '5', '6', '7+'];

function bedsText(bedrooms, bathrooms) {
  const bedZh = bedrooms === 'studio' ? '开放式' : `${bedrooms} 房`;
  const bedEn = bedrooms === 'studio' ? 'Studio' : `${bedrooms} Bed`;
  return { zh: `${bedZh} ${bathrooms} 卫`, en: `${bedEn} ${bathrooms} Bath` };
}

// Reads the old free-text format ("3+1 房 4 卫", "开放式 Studio 1 卫") so existing listings fill the dropdowns by themselves
function parseBeds(zh) {
  const m = /^\s*(开放式(?:\s*Studio)?|Studio|\d+\+\d+|\d+\+?)\s*房?\s*(\d+\+?)\s*卫\s*$/i.exec(String(zh || ''));
  if (!m) return null;
  const bedrooms = /^(开放式|studio)/i.test(m[1]) ? 'studio' : m[1];
  const bathrooms = m[2];
  return BEDROOMS.includes(bedrooms) && BATHROOMS.includes(bathrooms) ? { bedrooms, bathrooms } : null;
}

const MAX_PHOTOS = 20;

// A listing has 1-20 pictures; the first one is the cover. Older clients that only send `img` still work.
function photosFields(b) {
  let list;
  if (Array.isArray(b.photos) && b.photos.length) {
    if (b.photos.length > MAX_PHOTOS) throw new HttpError(400, `最多 ${MAX_PHOTOS} 张照片`);
    list = b.photos.map((p) => image(p, '房源照片'));
  } else {
    list = [image(b.img, '房源照片')];
  }
  list = [...new Set(list)]; // the same picture twice is pointless
  return { photos: list, img: list[0] };
}

function bedsFields(b) {
  if (b.bedrooms !== undefined || b.bathrooms !== undefined) {
    const bedrooms = String(b.bedrooms ?? '');
    const bathrooms = String(b.bathrooms ?? '');
    if (!BEDROOMS.includes(bedrooms)) throw new HttpError(400, '请选择房间数');
    if (!BATHROOMS.includes(bathrooms)) throw new HttpError(400, '请选择卫生间数');
    return { bedrooms, bathrooms, beds: bedsText(bedrooms, bathrooms) };
  }
  // older clients that still send free text
  const beds = bilingual(b.beds, '房型', 100, { required: true });
  const parsed = parseBeds(beds.zh);
  return { bedrooms: parsed ? parsed.bedrooms : null, bathrooms: parsed ? parsed.bathrooms : null, beds };
}

// Highlight tags shown under "Highlights & Facilities". Each one has a Chinese and an English text; a missing one
// falls back to the other, empty tags are dropped. `undefined` means "the client did not send them": leave as stored.
const MAX_HIGHLIGHTS = 12;
function highlights(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new HttpError(400, '亮点标签格式不对');
  if (value.length > MAX_HIGHLIGHTS * 2) throw new HttpError(400, `亮点标签最多 ${MAX_HIGHLIGHTS} 个`);
  const list = [];
  for (const item of value) {
    const o = item && typeof item === 'object' ? item : {};
    const zh = str(o.zh, '亮点标签（中文）', 40);
    const en = str(o.en, '亮点标签（英文）', 40);
    const key = typeof o.key === 'string' && /^[a-z0-9-]{1,40}$/.test(o.key) ? o.key : undefined;
    if (zh || en) list.push({ ...(key ? { key } : {}), zh: zh || en, en: en || zh });
  }
  if (list.length > MAX_HIGHLIGHTS) throw new HttpError(400, `亮点标签最多 ${MAX_HIGHLIGHTS} 个`);
  return list;
}

// "Available from" date: empty / null = available now. undefined = the client did not send it: leave as stored.
function availableFrom(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const s = typeof value === 'string' ? value.trim() : '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s || s < '2000-01-01' || s > '2100-12-31') {
    throw new HttpError(400, '可入住日期无效');
  }
  return s;
}

// Owner's phone number: only the admins ever see it. undefined = not sent: leave as stored; '' = clear it.
function ownerPhone(value) {
  if (value === undefined) return undefined;
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return '';
  if (s.length > 30 || !/^[+\d][\d\s\-().]*$/.test(s) || s.replace(/\D/g, '').length < 7) throw new HttpError(400, '屋主手机号格式不对');
  return s;
}

function property(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (!['rent', 'sale'].includes(b.type)) throw new HttpError(400, '类型必须是出租或出售');
  if (!AREAS.includes(b.area)) throw new HttpError(400, '地段无效');
  return {
    title: bilingual(b.title, '标题', 255, { required: true }),
    type: b.type,
    priceRM: int(b.priceRM, '价格', { max: 9999999999 }),
    areaSqft: int(b.areaSqft, '面积', { max: 1000000 }),
    ...bedsFields(b),
    area: b.area,
    location: bilingual(b.location, '地段显示名', 100),
    address: str(b.address, '地址', 255),
    ...photosFields(b),
    status: bilingual(b.status, '亮点标签', 255),
    desc: bilingual(b.desc, '描述', 5000),
    highlights: highlights(b.highlights),
    closed: b.closed === undefined ? undefined : b.closed === true,
    availableFrom: availableFrom(b.availableFrom),
    ownerPhone: ownerPhone(b.ownerPhone),
  };
}

// SIM / phone line (the /tracker/ page). The lists are the same ones the page offers in its dropdowns.
const SIM_TELCOS = ['Maxis', 'CelcomDigi', 'U Mobile', 'YES 5G', 'Unifi', 'Singtel', 'Other'];
// 60 days counting the top-up day itself as day 1: topped up today = 59 days left, the 60th day is the last one
const SIM_VALID_DAYS = 59;
const SIM_TAGS = ['Personal', 'Work', '2FA / OTP', 'Marketing', 'Backup'];

function sim(body) {
  const b = body && typeof body === 'object' ? body : {};
  // The line is valid for SIM_VALID_DAYS after its last top-up; the expiry date is worked out from it.
  // (An older open page may still send only expDate: that is read back as the top-up date.)
  const day = (v) => {
    const t = typeof v === 'string' ? v.trim() : '';
    const d = /^\d{4}-\d{2}-\d{2}$/.test(t) ? new Date(`${t}T00:00:00Z`) : null;
    return d && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t ? d : null;
  };
  const shift = (d, n) => new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);
  const top = day(b.topupDate) || (b.topupDate === undefined || b.topupDate === '' ? (day(b.expDate) && new Date(day(b.expDate).getTime() - SIM_VALID_DAYS * 86400000)) : null);
  if (!top) throw new HttpError(400, '最后充值日期无效');
  const topupDate = top.toISOString().slice(0, 10);
  const expDate = shift(top, SIM_VALID_DAYS);
  if (!SIM_TELCOS.includes(b.telco)) throw new HttpError(400, '电信商无效');
  const whatsapp = b.whatsapp === undefined || b.whatsapp === '' ? 'inactive' : b.whatsapp;
  if (!['active', 'inactive'].includes(whatsapp)) throw new HttpError(400, 'WhatsApp 状态无效');
  const tag = b.tag === undefined || b.tag === '' ? 'Personal' : b.tag;
  if (!SIM_TAGS.includes(tag)) throw new HttpError(400, '标签无效');
  return {
    phone: str(b.phone, '电话号码', 40, { required: true }),
    telco: b.telco,
    alias: str(b.alias, '别名', 120, { required: true }),
    topupDate,
    expDate,
    whatsapp,
    tag,
    notes: str(b.notes, '备注', 1000),
  };
}

function teamMember(body) {
  const b = body && typeof body === 'object' ? body : {};
  return {
    name: str(b.name, '姓名', 120, { required: true }),
    role: bilingual(b.role, '职称', 160, { required: true }),
    meta: bilingual(b.meta, '简介', 255),
    img: image(b.img, '头像'),
  };
}

// A 6-digit passcode only has 1,000,000 possibilities, so at least refuse the ones everybody tries first.
function weakPasscodeReason(code) {
  const d = [...code].map(Number);
  if (d.every((x) => x === d[0])) return '6 个数字不能都一样（例如 000000、888888）';
  const run = (n) => d.slice(1).every((x, i) => x - d[i] === n);
  if (run(1) || run(-1)) return '不能是连续的数字（例如 123456、654321）';
  if (code.slice(0, 2).repeat(3) === code || code.slice(0, 3).repeat(2) === code) return '不能是重复的图案（例如 121212、123123）';
  if (['112233', '123321', '520520', '201314', '520131', '131420'].includes(code)) return '这个密码太常见了，请换一个';
  return null;
}

function passcode(value, label = '密码') {
  const code = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, `${label}必须是 6 位数字`);
  const weak = weakPasscodeReason(code);
  if (weak) throw new HttpError(400, `${label}太容易被猜到：${weak}`);
  return code;
}

function adminName(value) {
  return str(value, '名字', 60, { required: true });
}

const SLOTS = ['all', 'day', 'night'];

function isoDate(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw new HttpError(400, `${label}不是有效的日期`);
  }
  return s;
}

function heroBanner(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (!SLOTS.includes(b.slot)) throw new HttpError(400, '时段必须是全天、白天或夜晚');
  const startDate = isoDate(b.startDate, '开始日期');
  const endDate = isoDate(b.endDate, '结束日期');
  if (startDate && endDate && endDate < startDate) throw new HttpError(400, '结束日期不能早于开始日期');
  if (typeof b.active !== 'boolean') throw new HttpError(400, '请选择启用或停用');
  return {
    title: str(b.title, '名称', 80),
    img: image(b.img, '横幅照片'),
    slot: b.slot,
    startDate,
    endDate,
    active: b.active,
  };
}

module.exports = {
  BEDROOMS, BATHROOMS, bedsText, parseBeds,
  heroBanner,
  weakPasscodeReason, passcode, adminName, HttpError, AREAS, image, property, sim, teamMember };
