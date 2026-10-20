require('dotenv').config(process.env.ENV_FILE ? { path: process.env.ENV_FILE } : undefined);
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const repo = require('./repo');
const v = require('./validate');

const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;
const COOKIE = 'luxe_admin';
const SESSION_HOURS = 12;

// REMOTE_DB=1 means this copy of the app is connected to the LIVE database (through an SSH tunnel).
// Uploaded images are stored on this machine's disk, not on the live server, so uploads are disabled
// in that mode to avoid live listings pointing at files that only exist locally.
const REMOTE_DB = process.env.REMOTE_DB === '1';

if (!process.env.JWT_SECRET) {
  console.warn('⚠ 未设置 JWT_SECRET，后台登录不可用。请运行 npm run set-admin');
}

const app = express();
app.set('trust proxy', 1); // behind nginx on the VPS
// CSP is off because the pages load Tailwind / FontAwesome / fonts from CDNs and use inline handlers.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- public API ----------
app.get('/api/content', wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await repo.getContent());
}));

// ---------- admin auth ----------
// Who is signed in? Reads the session cookie, then checks the admin still exists and is active in the database,
// so disabling or deleting an admin cuts off their open session immediately.
async function currentAdmin(req) {
  try {
    const { sub } = jwt.verify(req.cookies[COOKIE], process.env.JWT_SECRET);
    const admin = await repo.getAdmin(Number(sub));
    return admin && admin.active ? admin : null;
  } catch (e) {
    return null; // no / invalid cookie, or the database is not reachable
  }
}

const requireAdmin = wrap(async (req, res, next) => {
  const admin = await currentAdmin(req);
  if (!admin) return res.status(401).json({ error: '请先登录' });
  req.admin = admin;
  next();
});

const requireOwner = (req, res, next) => (
  req.admin && req.admin.owner ? next() : res.status(403).json({ error: '只有所有者可以管理其他管理员' })
);

// Reject cross-site writes (cookies are also SameSite=Strict)
function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (origin && new URL(origin).host !== req.get('host')) {
    return res.status(403).json({ error: '来源不被允许' });
  }
  next();
}

// A 6-digit passcode has only 1,000,000 combinations, so guessing is limited hard (failed attempts only):
//  - per IP:  5 wrong tries / 15 minutes
//  - overall: 15 wrong tries / hour across ALL IPs (stops attackers who rotate addresses)
// The limits are held in memory and reset when the app restarts.
const limitOpts = { standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true };
const ipLoginLimiter = rateLimit({
  ...limitOpts,
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: { error: '输错次数太多，请 15 分钟后再试' },
});
const globalLoginLimiter = rateLimit({
  ...limitOpts,
  windowMs: 60 * 60 * 1000,
  limit: 15,
  keyGenerator: () => 'all-visitors',
  message: { error: '后台因多次输错已暂时锁定，请 1 小时后再试' },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Each admin has their own passcode: the one that matches tells us who is signing in.
app.post('/api/admin/login', sameOrigin, ipLoginLimiter, globalLoginLimiter, wrap(async (req, res) => {
  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ error: '服务器还没设置登录密钥，请在服务器上运行 npm run set-admin' });
  }
  const passcode = String((req.body && req.body.passcode) ?? '');
  if (!/^\d{6}$/.test(passcode)) return res.status(400).json({ error: '请输入 6 位数字密码' });

  const admins = await repo.getAdminsWithHash({ activeOnly: true });
  const everyone = await repo.listAdmins();
  if (everyone.length === 0) {
    return res.status(503).json({ error: '后台密码尚未设置，请在服务器上运行 npm run set-admin' });
  }

  let who = null;
  for (const a of admins) {
    if (await bcrypt.compare(passcode, a.hash)) { who = a; break; }
  }
  if (!who) {
    await sleep(600); // slows down automated guessing
    return res.status(401).json({ error: '密码不对，请再试一次' });
  }

  await repo.touchAdminLogin(who.id);
  const token = jwt.sign({ sub: String(who.id) }, process.env.JWT_SECRET, { expiresIn: `${SESSION_HOURS}h` });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProd,
    maxAge: SESSION_HOURS * 3600 * 1000,
  });
  res.json({ ok: true });
}));

app.post('/api/admin/logout', sameOrigin, (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ ok: true, remoteDb: REMOTE_DB, admin: { id: req.admin.id, name: req.admin.name, owner: req.admin.owner } });
});

// ---------- admin API (login required) ----------
const admin = express.Router();
admin.use(sameOrigin, requireAdmin);

const idParam = (req) => Number.parseInt(req.params.id, 10);
const notFound = (res) => res.status(404).json({ error: '找不到这条记录' });

// ----- managing admins (owner), changing your own passcode (everyone) -----
const bcryptCost = 12;

async function passcodeInUse(code, exceptId) {
  const all = await repo.getAdminsWithHash();
  for (const a of all) {
    if (a.id !== exceptId && await bcrypt.compare(code, a.hash)) return true;
  }
  return false;
}

admin.get('/admins', requireOwner, wrap(async (req, res) => {
  res.json({ admins: await repo.listAdmins() });
}));

admin.post('/admins', requireOwner, wrap(async (req, res) => {
  const name = v.adminName(req.body && req.body.name);
  const code = v.passcode(req.body && req.body.passcode);
  if (await passcodeInUse(code)) return res.status(400).json({ error: '这个密码已经有人在用，请换一个' });
  const id = await repo.createAdmin(name, await bcrypt.hash(code, bcryptCost));
  res.status(201).json({ id });
}));

admin.put('/admins/:id', requireOwner, wrap(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const target = await repo.getAdmin(id);
  if (!target) return notFound(res);
  const fields = {};
  if (req.body && 'name' in req.body) fields.name = v.adminName(req.body.name);
  if (req.body && 'active' in req.body) {
    if (typeof req.body.active !== 'boolean') return res.status(400).json({ error: '参数不正确' });
    if (!req.body.active && (target.owner || target.id === req.admin.id)) {
      return res.status(400).json({ error: '不能停用所有者或你自己的账号' });
    }
    fields.active = req.body.active;
  }
  await repo.updateAdmin(id, fields);
  res.json({ ok: true });
}));

admin.delete('/admins/:id', requireOwner, wrap(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const target = await repo.getAdmin(id);
  if (!target) return notFound(res);
  if (target.owner || target.id === req.admin.id) return res.status(400).json({ error: '不能删除所有者或你自己的账号' });
  await repo.deleteAdmin(id);
  res.json({ ok: true });
}));

// The owner can set anybody's passcode; everybody else can only change their own, and must give the current one.
admin.put('/admins/:id/passcode', wrap(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const isSelf = id === req.admin.id;
  if (!isSelf && !req.admin.owner) return res.status(403).json({ error: '只能修改自己的密码' });

  const target = (await repo.getAdminsWithHash()).find((a) => a.id === id);
  if (!target) return notFound(res);

  if (isSelf) {
    const current = String((req.body && req.body.currentPasscode) ?? '');
    if (!/^\d{6}$/.test(current) || !(await bcrypt.compare(current, target.hash))) {
      await sleep(600);
      return res.status(403).json({ error: '当前密码不对' });
    }
  }
  const code = v.passcode(req.body && req.body.passcode, '新密码');
  if (await passcodeInUse(code, id)) return res.status(400).json({ error: '这个密码已经有人在用，请换一个' });
  await repo.setAdminPasscode(id, await bcrypt.hash(code, bcryptCost));
  res.json({ ok: true });
}));

// ----- scheduled hero banners (which picture shows depends on date and day/night, GMT+8) -----
admin.get('/hero-banners', wrap(async (req, res) => {
  res.json({ banners: await repo.listHeroBanners() });
}));
admin.post('/hero-banners', wrap(async (req, res) => {
  res.status(201).json({ id: await repo.createHeroBanner(v.heroBanner(req.body)) });
}));
admin.put('/hero-banners/:id', wrap(async (req, res) => {
  (await repo.updateHeroBanner(idParam(req), v.heroBanner(req.body))) ? res.json({ ok: true }) : notFound(res);
}));
admin.delete('/hero-banners/:id', wrap(async (req, res) => {
  (await repo.deleteHeroBanner(idParam(req))) ? res.json({ ok: true }) : notFound(res);
}));

admin.put('/hero', wrap(async (req, res) => {
  await repo.setHero(v.image(req.body && req.body.img, '横幅照片'));
  res.json({ ok: true });
}));

admin.post('/properties', wrap(async (req, res) => {
  res.status(201).json({ id: await repo.createProperty(v.property(req.body)) });
}));
admin.put('/properties/:id', wrap(async (req, res) => {
  (await repo.updateProperty(idParam(req), v.property(req.body))) ? res.json({ ok: true }) : notFound(res);
}));
admin.delete('/properties/:id', wrap(async (req, res) => {
  (await repo.deleteProperty(idParam(req))) ? res.json({ ok: true }) : notFound(res);
}));

admin.post('/team', wrap(async (req, res) => {
  res.status(201).json({ id: await repo.createTeamMember(v.teamMember(req.body)) });
}));
admin.put('/team/:id', wrap(async (req, res) => {
  (await repo.updateTeamMember(idParam(req), v.teamMember(req.body))) ? res.json({ ok: true }) : notFound(res);
}));
admin.delete('/team/:id', wrap(async (req, res) => {
  (await repo.deleteTeamMember(idParam(req))) ? res.json({ ok: true }) : notFound(res);
}));

// Image upload: stored in /uploads, the response gives the path to save in the database.
fs.mkdirSync(repo.UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: repo.UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + '.tmp'),
  }),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
});

// Decide the real image type from the file's first bytes (the browser-supplied type can be faked)
function detectImageExt(file) {
  const b = fs.readFileSync(file, { flag: 'r' }).subarray(0, 12);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (b.subarray(0, 4).toString() === 'GIF8') return 'gif';
  return null;
}

admin.post('/upload', (req, res, next) => {
  if (REMOTE_DB) {
    return res.status(403).json({ error: '当前连接的是线上数据库，本地不能上传图片（图片只会存在你的电脑里，线上会变成破图）。请到线上后台上传，或粘贴图片链接。' });
  }
  next();
}, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '没有收到图片' });
  const ext = detectImageExt(req.file.path);
  if (!ext) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: '只支持 JPG、PNG、WebP、GIF 图片' });
  }
  const finalName = req.file.filename.replace(/\.tmp$/, '.' + ext);
  fs.renameSync(req.file.path, path.join(repo.UPLOAD_DIR, finalName));
  res.status(201).json({ url: `uploads/${finalName}` });
});

app.use('/api/admin', admin);
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

// ---------- shareable listing links ----------
// /listing/12 is the home page with that listing's detail sheet already open. Messaging apps (WhatsApp, Instagram,
// Facebook...) do not run JavaScript when they build a link preview, so the server writes the preview tags
// (title, price line, cover picture) into the HTML itself.
const escHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function listingPreviewTags(p, origin, lang = 'zh') {
  const en = lang === 'en';
  const price = p.type === 'rent'
    ? `RM ${p.priceRM.toLocaleString('en-US')} ${en ? '/ month' : '/ 月'}`
    : en ? `RM ${(p.priceRM / 1000000).toFixed(2)}M` : `RM ${(p.priceRM / 10000).toFixed(0)} 万`;
  const name = en ? p.title.en : p.title.zh;
  const title = `${name} | m.boutiquehomes`;
  const description = [price, en ? p.beds.en : p.beds.zh, `${p.areaSqft.toLocaleString('en-US')} sqft`, en ? p.location.en : p.location.zh].filter(Boolean).join(' · ');
  const cover = p.photos && p.photos.length ? p.photos[0] : p.img;
  const image = /^https?:\/\//i.test(cover) ? cover : `${origin}/${cover.replace(/^\/+/, '')}`;
  const url = `${origin}/${en ? 'EN' : 'CH'}/listing/${p.code || p.id}`;
  return {
    title,
    tags: [
      `<link rel="canonical" href="${escHtml(url)}">`,
      '<meta property="og:type" content="website">',
      '<meta property="og:site_name" content="m.boutiquehomes">',
      `<meta property="og:locale" content="${en ? 'en_US' : 'zh_CN'}">`,
      `<meta property="og:title" content="${escHtml(title)}">`,
      `<meta property="og:description" content="${escHtml(description)}">`,
      `<meta property="og:url" content="${escHtml(url)}">`,
      `<meta property="og:image" content="${escHtml(image)}">`,
      `<meta property="og:image:alt" content="${escHtml(name)}">`,
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="twitter:title" content="${escHtml(title)}">`,
      `<meta name="twitter:description" content="${escHtml(description)}">`,
      `<meta name="twitter:image" content="${escHtml(image)}">`,
      `<meta name="description" content="${escHtml(description)}">`,
    ].join('\n    '),
  };
}

// /CH and /EN are the home page, /CH/listings and /EN/listings the listings page, in that language
// (the page itself reads the language from the address). <base href="/"> keeps its relative files working.
async function sendSitePage(res, file) {
  let html = await fs.promises.readFile(path.join(__dirname, '..', 'public', file), 'utf8');
  html = html.replace('<head>', '<head>\n    <base href="/">');
  res.set('Cache-Control', 'no-cache').type('html').send(html);
}
app.get(/^\/(?:CH|EN)\/?$/i, wrap((req, res) => sendSitePage(res, 'index.html')));
app.get(/^\/(?:CH|EN)\/listings\/?$/i, wrap((req, res) => sendSitePage(res, 'listings/index.html')));

// /listing/<code> (language = the visitor's own), /CH/listing/<code> (中文), /EN/listing/<code> (English)
app.get(/^\/(?:(CH|EN)\/)?listing\/([A-Za-z0-9]+)\/?$/i, wrap(async (req, res) => {
  const prefix = req.params[0] ? req.params[0].toUpperCase() : '';
  const ref = String(req.params[1]);
  const lang = prefix === 'EN' ? 'en' : 'zh';
  const origin = `${req.protocol}://${req.get('host')}`;
  // old links with the plain number (/listing/6) are sent on to the private code
  if (/^\d+$/.test(ref)) {
    const old = await repo.getPropertyById(Number(ref));
    if (old && old.code) return res.redirect(301, `${prefix ? `/${prefix}` : ''}/listing/${old.code}`);
  }
  let html = await fs.promises.readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  // the page lives at /listing/<code>, so its relative links (style.css, img/...) must still point at the site root
  html = html.replace('<head>', '<head>\n    <base href="/">');
  const property = /^[a-z0-9]{6,16}$/.test(ref) ? await repo.getPropertyByCode(ref) : null;
  if (property) {
    const preview = listingPreviewTags(property, origin, lang);
    html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escHtml(preview.title)}</title>`).replace('</head>', `    ${preview.tags}\n</head>`);
  }
  res.set('Cache-Control', 'no-cache').type('html').send(html);
}));

// ---------- admin pages ----------
// /admin           the login page (public). A signed-in admin is sent straight to the dashboard.
// /admin/dashboard the control panel. The server only sends it to a signed-in admin; everybody else is redirected
//                  to /admin, so the panel's HTML and script never reach (or flash in front of) a visitor.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PRIVATE_ADMIN_DIR = path.join(__dirname, '..', 'private', 'admin');
const noStore = (res) => res.set('Cache-Control', 'no-store');

app.get('/admin', wrap(async (req, res) => {
  noStore(res);
  // Always use the trailing-slash URL so every relative link on the page resolves the same way
  if (!req.originalUrl.startsWith('/admin/')) return res.redirect(301, '/admin/');
  if (await currentAdmin(req)) return res.redirect('/admin/dashboard');
  res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html'));
}));

app.get('/admin/dashboard', wrap(async (req, res) => {
  noStore(res);
  if (!(await currentAdmin(req))) return res.redirect('/admin/');
  res.sendFile(path.join(PRIVATE_ADMIN_DIR, 'dashboard.html'));
}));

app.use(
  '/admin/app',
  wrap(async (req, res, next) => ((await currentAdmin(req)) ? next() : res.status(401).type('text/plain').send('请先登录'))),
  express.static(PRIVATE_ADMIN_DIR, { index: false, setHeaders: (res) => noStore(res) })
);

// ---------- static site ----------
app.use('/uploads', express.static(repo.UPLOAD_DIR, { maxAge: '30d', immutable: true, index: false }));
app.use(express.static(PUBLIC_DIR));

// Unknown pages get a branded 404 page (API paths already returned JSON 404 above)
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
});

// ---------- errors ----------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 6MB' : '上传失败' });
  }
  if (err instanceof v.HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: '服务器出错了，请稍后再试' });
});

repo.ensurePropertyPhotos().catch((err) => console.warn('⚠ 照片表暂时无法准备（数据库连不上？）：', err.message));
repo.ensurePropertyColumns().catch((err) => console.warn('⚠ 房型字段暂时无法准备（数据库连不上？）：', err.message));
repo.ensureHeroBanners().catch((err) => console.warn('⚠ 横幅表暂时无法准备（数据库连不上？）：', err.message));
repo.ensureAdmins().catch((err) => console.warn('⚠ 管理员表暂时无法准备（数据库连不上？）：', err.message));

app.listen(PORT, () => {
  console.log(`m.boutiquehomes running on http://localhost:${PORT}`);
  if (REMOTE_DB) {
    console.warn('\n⚠⚠⚠  当前连接的是【线上数据库】：你在后台做的任何修改都会直接影响真实网站！  ⚠⚠⚠\n');
  }
});
