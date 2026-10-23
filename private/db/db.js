// /db: database status dashboard. Reads /api/admin/db-status (owner only) and redraws every 10 seconds.
const $ = (id) => document.getElementById(id);
const REFRESH_MS = 10000;
const history = [];            // last response times (ms), newest last
let timer = 0;
let busy = false;
let firstDone = false;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => (n == null || Number.isNaN(n) ? '–' : Number(n).toLocaleString('en-US'));

function bytes(n) {
    if (n == null || Number.isNaN(n)) return '–';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = Number(n);
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
function compact(n) {
    if (n == null) return '–';
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
    return num(n);
}
function duration(sec) {
    if (sec == null) return '–';
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) return `${d} 天 ${h} 小时`;
    if (h) return `${h} 小时 ${m} 分`;
    return m ? `${m} 分 ${sec % 60} 秒` : `${sec} 秒`;
}
const clock = (iso) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour12: false });
const level = (pct, warn, bad) => (pct >= bad ? 'bad' : pct >= warn ? 'warn' : '');

function toast(message, isError = false) {
    const el = $('toast');
    el.textContent = message;
    el.className = `toast show${isError ? ' error' : ''}`;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.className = 'toast'; }, 3000);
}

// ---------- drawing ----------
function drawSpark() {
    const svg = $('spark');
    $('sparkN').textContent = history.length;
    if (history.length < 2) {
        svg.innerHTML = '<text x="150" y="32" text-anchor="middle" fill="rgba(255,255,255,.35)" font-size="11" font-family="Plus Jakarta Sans, sans-serif">正在收集响应时间…</text>';
        return;
    }
    const W = 300, H = 56, pad = 6;
    const max = Math.max(...history, 5);
    const min = Math.min(...history, 0);
    const span = max - min || 1;
    const pts = history.map((v, i) => [(i / (history.length - 1)) * W, H - pad - ((v - min) / span) * (H - pad * 2)]);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const [lx, ly] = pts[pts.length - 1];
    svg.innerHTML = `
        <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c5a059" stop-opacity=".45"/><stop offset="1" stop-color="#c5a059" stop-opacity="0"/></linearGradient></defs>
        <path d="${line} L${W} ${H} L0 ${H} Z" fill="url(#sg)"/>
        <path d="${line}" fill="none" stroke="#d4af37" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3.2" fill="#fff" stroke="#d4af37" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
}

function renderHero(d) {
    const hero = $('hero');
    hero.classList.remove('is-loading', 'is-up', 'is-down');
    hero.classList.add(d.connected ? 'is-up' : 'is-down');
    $('heroLabel').textContent = d.connected ? '数据库运行正常' : '无法连接数据库';
    const uptime = d.status && d.status.Uptime != null ? `已运行 ${duration(d.status.Uptime)}` : '';
    const ver = d.server ? `MySQL ${d.server.version.split('-')[0]}` : '';
    $('heroSub').textContent = d.connected ? [ver, uptime].filter(Boolean).join(' · ') : `错误：${d.error || '未知'}`;
    $('heroMs').textContent = d.latencyMs != null ? (d.latencyMs < 10 ? d.latencyMs.toFixed(1) : Math.round(d.latencyMs)) : '–';
    $('heroTime').textContent = `更新于 ${clock(d.time)}`;
    $('footTime').textContent = `服务器时间 ${clock(d.time)}（GMT+8）`;
}

function renderChecks(d) {
    const items = [];
    const add = (state, icon, text) => items.push(`<span class="check ${state}"><i class="fa-solid ${icon}"></i>${esc(text)}</span>`);
    if (!d.connected) {
        add('bad', 'fa-circle-xmark', '数据库连接失败');
    } else {
        add('', 'fa-circle-check', '数据库连接正常');
        if (d.latencyMs != null) {
            if (d.latencyMs < 50) add('', 'fa-bolt', '响应很快');
            else if (d.latencyMs < 200) add('warn', 'fa-gauge', `响应偏慢（${Math.round(d.latencyMs)} ms）`);
            else add('bad', 'fa-gauge', `响应很慢（${Math.round(d.latencyMs)} ms）`);
        }
        if (d.status && d.server) {
            const pct = (d.status.Threads_connected / d.server.maxConnections) * 100;
            if (pct < 70) add('', 'fa-plug-circle-check', '连接数充足');
            else add(pct >= 90 ? 'bad' : 'warn', 'fa-plug-circle-exclamation', `连接数偏高（${Math.round(pct)}%）`);
            if (!d.status.Slow_queries) add('', 'fa-gauge-high', '没有慢查询');
            else add('warn', 'fa-hourglass-half', `有 ${num(d.status.Slow_queries)} 条慢查询`);
        }
    }
    if (d.disk) {
        const free = (d.disk.freeBytes / d.disk.totalBytes) * 100;
        if (free >= 20) add('', 'fa-hard-drive', `磁盘剩余 ${Math.round(free)}%`);
        else add(free < 10 ? 'bad' : 'warn', 'fa-hard-drive', `磁盘只剩 ${Math.round(free)}%`);
    }
    if (d.connection.remote) add('warn', 'fa-link', '本机正连着线上数据库');
    $('checks').innerHTML = items.join('');
}

function metric(icon, label, value, unit, note, barPct, barLevel) {
    return `<div class="metric">
        <span class="m-icon"><i class="fa-solid ${icon}"></i></span>
        <span class="m-label">${esc(label)}</span>
        <span class="m-value">${value}${unit ? `<small>${esc(unit)}</small>` : ''}</span>
        ${barPct != null ? `<div class="bar ${barLevel || ''}"><i style="width:${Math.max(2, Math.min(100, barPct))}%"></i></div>` : ''}
        <span class="m-note">${esc(note || '')}</span>
    </div>`;
}

function renderMetrics(d) {
    const s = d.status, max = d.server && d.server.maxConnections;
    const connPct = s && max ? (s.Threads_connected / max) * 100 : null;
    const diskUsed = d.disk ? (1 - d.disk.freeBytes / d.disk.totalBytes) * 100 : null;
    $('metrics').innerHTML = [
        metric('fa-plug', '当前连接', s ? num(s.Threads_connected) : '–', max ? `/ ${num(max)}` : '', s ? `历史最高 ${num(s.Max_used_connections)}` : '', connPct, level(connPct ?? 0, 70, 90)),
        metric('fa-microchip', '正在执行', s ? num(s.Threads_running) : '–', '', '同时在跑的查询'),
        metric('fa-database', '数据库大小', bytes(d.totals.bytes), '', `${num(d.tables.length)} 张表 · ${num(d.totals.rows)} 行`),
        metric('fa-hard-drive', '磁盘剩余', d.disk ? bytes(d.disk.freeBytes) : '–', '', d.disk ? `共 ${bytes(d.disk.totalBytes)}` : '', diskUsed, level(diskUsed ?? 0, 80, 90)),
        metric('fa-magnifying-glass-chart', '累计查询', s ? compact(s.Questions) : '–', '', s ? `自启动以来 · 慢查询 ${num(s.Slow_queries)}` : ''),
        metric('fa-images', '上传图片', d.uploads ? num(d.uploads.files) : '–', '张', d.uploads ? `占用 ${bytes(d.uploads.bytes)}` : ''),
    ].join('');
}

function renderContent(d) {
    const c = d.content;
    const tile = (n, label) => `<div class="tile"><b>${num(n)}</b><span>${esc(label)}</span></div>`;
    $('content').innerHTML = c ? [
        tile(c.listings, '房源'), tile(c.closed, '已售/已租'), tile(c.photos, '房源照片'),
        tile(c.team, '顾问'), tile(c.banners, '横幅'), tile(c.admins, '管理员'),
    ].join('') : '<p style="grid-column:1/-1;color:#8a909b;font-size:.75rem;margin:0">暂时读不到网站内容。</p>';
}

function renderTables(d) {
    $('tablesTotal').textContent = `${num(d.tables.length)} 张 · ${bytes(d.totals.bytes)}`;
    const biggest = Math.max(1, ...d.tables.map(t => t.bytes));
    $('tables').innerHTML = d.tables.length ? d.tables.map(t => `
        <div>
            <div class="trow-top"><b>${esc(t.name)}</b><span>${num(t.rows)} 行 · ${bytes(t.bytes)}</span></div>
            <div class="bar"><i style="width:${Math.max(3, (t.bytes / biggest) * 100)}%"></i></div>
        </div>`).join('') : '<p style="color:#8a909b;font-size:.75rem;margin:0">没有读到数据表。</p>';
}

function renderDetails(d) {
    const s = d.status || {}, sv = d.server || {};
    const rows = [
        ['数据库版本', sv.version ? `${sv.version.split('-')[0]}${sv.flavour ? ` · ${sv.flavour.split(' ')[0]}` : ''}` : '–'],
        ['连接地址', `${d.connection.host}:${d.connection.port}`],
        ['数据库名', d.connection.database || '–'],
        ['连接方式', d.connection.remote ? '本机经 SSH 隧道连线上库' : '本机直连'],
        ['字符集', sv.charset || '–'],
        ['数据库运行时间', s.Uptime != null ? duration(s.Uptime) : '–'],
        ['累计连接次数', s.Connections != null ? num(s.Connections) : '–'],
        ['异常断开', s.Aborted_connects != null ? `${num(s.Aborted_connects)} 次` : '–'],
        ['累计数据收发', s.Bytes_received != null ? `↓ ${bytes(s.Bytes_received)} · ↑ ${bytes(s.Bytes_sent)}` : '–'],
        ['缓冲池', sv.bufferPool ? bytes(sv.bufferPool) : '–'],
        ['网站程序', `Node ${d.app.nodeVersion} · ${d.app.env}`],
        ['网站程序运行', `${duration(d.app.uptimeSec)} · ${d.app.memoryMb} MB`],
    ];
    $('details').innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
}

function showSkeleton() {
    $('metrics').innerHTML = Array.from({ length: 6 }, () => '<div class="metric"><span class="m-icon is-skel"></span><span class="m-label is-skel">加载中</span><span class="m-value is-skel">0000</span><span class="m-note is-skel">加载中……</span></div>').join('');
    $('tables').innerHTML = Array.from({ length: 4 }, () => '<div class="is-skel" style="height:2.2rem"></div>').join('');
    $('content').innerHTML = Array.from({ length: 6 }, () => '<div class="tile is-skel" style="height:3.4rem"></div>').join('');
    $('details').innerHTML = Array.from({ length: 5 }, () => '<div class="is-skel" style="height:1.6rem;margin:0.35rem 0"></div>').join('');
}

function render(d) {
    renderHero(d);
    renderChecks(d);
    renderMetrics(d);
    renderContent(d);
    renderTables(d);
    renderDetails(d);
}

// ---------- loading ----------
async function load(manual = false) {
    if (busy) return;
    busy = true;
    $('refreshBtn').classList.add('spinning');
    try {
        const res = await fetch('/api/admin/db-status', { credentials: 'same-origin', cache: 'no-store' });
        if (res.status === 401) { location.href = '/admin/'; return; }
        if (res.status === 403) { $('heroLabel').textContent = '只有所有者可以查看'; $('hero').classList.add('is-down'); return; }
        if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
        const d = await res.json();
        if (d.latencyMs != null) { history.push(d.latencyMs); if (history.length > 30) history.shift(); }
        render(d);
        drawSpark();
        firstDone = true;
        if (manual) toast('已更新');
    } catch (err) {
        // the page itself came from the server, so a failure here means the site/API is not answering
        const hero = $('hero');
        hero.classList.remove('is-loading', 'is-up');
        hero.classList.add('is-down');
        $('heroLabel').textContent = '无法获取状态';
        $('heroSub').textContent = firstDone ? '网络或服务器没有响应，稍后会自动重试' : err.message;
        $('heroMs').textContent = '–';
        if (manual) toast('更新失败，请检查网络', true);
    } finally {
        busy = false;
        $('refreshBtn').classList.remove('spinning');
    }
}

function schedule() {
    clearInterval(timer);
    if ($('liveToggle').checked) {
        timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    }
}

$('refreshBtn').addEventListener('click', () => load(true));
$('liveToggle').addEventListener('change', () => { schedule(); toast($('liveToggle').checked ? '已开启自动更新' : '已暂停自动更新'); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && $('liveToggle').checked) load(); });

showSkeleton();
load();
schedule();
