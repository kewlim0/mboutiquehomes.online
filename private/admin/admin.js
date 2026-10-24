// Admin page: edits the site content (hero image, listings, team) through the Express/MySQL API.

const $ = (id) => document.getElementById(id);
const API = Store.ROOT + 'api/';
let content = { hero: { img: '' }, properties: [], team: [] };

const AREA_LABELS = {
    'KLCC': { zh: 'KLCC 核心区', en: 'KLCC Core' },
    'Mont Kiara': { zh: 'Mont Kiara', en: 'Mont Kiara' },
    'TRX': { zh: 'TRX', en: 'TRX' },
    'Bangsar': { zh: 'Bangsar', en: 'Bangsar' },
    'Outskirt': { zh: '郊区', en: 'Outskirt' },
    'Bukit Tunku': { zh: 'Bukit Tunku', en: 'Bukit Tunku' },
    'Damansara Heights': { zh: 'Damansara Heights', en: 'Damansara Heights' },
    'Seputeh': { zh: 'Seputeh', en: 'Seputeh' }
};

// Renovation status is picked from a list. To offer another option, add a line here (Chinese and English text).
const RENOVATION_OPTIONS = [
    { zh: '95% 新', en: '95% New' },
    { zh: '90% 新', en: '90% New' },
    { zh: '85% 新', en: '85% New' }
];

// ---------- helpers ----------
function esc(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

let toastTimer;
function toast(message, isError = false) {
    const el = $('toast');
    el.textContent = message;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 3000);
}

class UnauthorizedError extends Error {}

// Call the API. A 401 sends the user back to the login screen.
async function api(method, path, body) {
    const res = await fetch(API + path, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== 'admin/login') {
        showLogin();
        throw new UnauthorizedError('登录已过期，请重新登录');
    }
    if (!res.ok) throw new Error(data.error || '操作失败，请稍后再试');
    return data;
}

// Run an API action, show a toast and refresh the lists. Returns true on success.
async function run(action, successMessage) {
    try {
        await action();
        if (successMessage) toast(successMessage);
        await refresh();
        return true;
    } catch (err) {
        if (!(err instanceof UnauthorizedError)) toast(err.message, true);
        return false;
    }
}

// Scale an image down and return it as a JPEG blob (keeps uploads small)
function fileToBlob(file, maxWidth, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败，请换一张图片')); };
        img.onload = () => {
            URL.revokeObjectURL(url);
            const scale = Math.min(1, maxWidth / img.width);
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片处理失败')), 'image/jpeg', quality);
        };
        img.src = url;
    });
}

async function uploadImage(file, maxWidth) {
    const blob = await fileToBlob(file, maxWidth);
    const form = new FormData();
    form.append('image', blob, 'image.jpg');
    const res = await fetch(API + 'admin/upload', { method: 'POST', credentials: 'same-origin', body: form });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { showLogin(); throw new UnauthorizedError('登录已过期，请重新登录'); }
    if (!res.ok) throw new Error(data.error || '图片上传失败');
    return data.url; // e.g. "uploads/abc123.jpg"
}

// ---------- reusable image field (preview + upload + URL) ----------
function imageFieldHtml(id, label, previewClass) {
    return `
        <div class="space-y-2">
            <span class="block text-[11px] font-bold text-gray-700">${label}</span>
            <div class="img-preview ${previewClass}"><img id="${id}-preview" alt="预览"><div class="img-empty"><i class="fa-regular fa-image"></i><span>还没有照片</span></div></div>
            <div class="flex flex-wrap items-center gap-2">
                <label class="btn-ghost cursor-pointer">
                    <i class="fa-solid fa-upload mr-1.5"></i><span id="${id}-label">上传图片</span>
                    <input id="${id}-file" type="file" accept="image/*" class="hidden">
                </label>
                <span class="text-[11px] text-gray-400">或粘贴图片链接</span>
                <input id="${id}-url" type="url" placeholder="https://..." class="flex-1 min-w-[10rem] text-xs px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-gold-500">
            </div>
            <input id="${id}" type="hidden">
        </div>`;
}

function setImageField(id, path) {
    $(id).value = path || '';
    $(`${id}-preview`).src = path ? Store.resolve(path) : '';
    $(`${id}-url`).value = /^https?:/.test(path || '') ? path : '';
}

function bindImageField(id, maxWidth) {
    $(`${id}-file`).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        $(`${id}-label`).textContent = '上传中…';
        try {
            setImageField(id, await uploadImage(file, maxWidth));
        } catch (err) {
            if (!(err instanceof UnauthorizedError)) toast(err.message, true);
        } finally {
            $(`${id}-label`).textContent = '上传图片';
        }
    });
    $(`${id}-url`).addEventListener('input', (e) => setImageField(id, e.target.value.trim()));
    $(`${id}-preview`).addEventListener('error', () => { $(`${id}-preview`).removeAttribute('src'); });
}

// ---------- sign-in state ----------
// This page is only served to a signed-in admin. If the session ends while it is open (12h), go back to the login page.
function showLogin() {
    window.location.replace('/admin/');
}

$('logoutBtn').addEventListener('click', async () => {
    try { await api('POST', 'admin/logout'); } catch (err) { /* already signed out */ }
    window.location.replace('/admin/');
});

// ---------- tabs ----------
function showTab(name) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== `tab-${name}`));
    $('bannerFab').classList.toggle('hidden', name !== 'hero');
    document.body.classList.toggle('has-fab', name === 'hero'); // leaves room so the round button never covers content
    try { sessionStorage.setItem('admin-tab', name); } catch (e) { /* ignore */ }
}

document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------- hero banners ----------
// Default banner: shown whenever no scheduled banner matches the current date / time.
$('heroField').innerHTML = imageFieldHtml('hero-img', '默认横幅照片', 'aspect-[16/9] w-full max-w-xl');
bindImageField('hero-img', 1400);

$('heroSave').addEventListener('click', () => {
    const img = $('hero-img').value;
    if (!img) { toast('请先选择一张横幅照片', true); return; }
    run(() => api('PUT', 'admin/hero', { img }), '默认横幅已更新');
});

$('heroReset').addEventListener('click', () => {
    run(() => api('PUT', 'admin/hero', { img: 'img/banner-main.jpeg' }), '已恢复原来的默认图');
});

// Scheduled banners
let banners = [];           // every scheduled banner (also the disabled ones), newest first
let editingBannerId = null;
$('bn-img-wrap').innerHTML = imageFieldHtml('bn-img', '横幅照片', 'aspect-[16/9] w-full');
bindImageField('bn-img', 1400);

const heroSource = () => ({ img: content.hero.img, banners });
const pad2 = (n) => String(n).padStart(2, '0');

function fmtDay(ymd) {
    if (!ymd) return '';
    const [y, m, d] = ymd.split('-').map(Number);
    const thisYear = Number(Store.gmt8().ymd.slice(0, 4));
    return `${y !== thisYear ? y + '年' : ''}${m}月${d}日`;
}

function dateText(start, end) {
    if (!start && !end) return '每天';
    if (start && end) return start === end ? fmtDay(start) : `${fmtDay(start)} – ${fmtDay(end)}`;
    return start ? `${fmtDay(start)} 起` : `至 ${fmtDay(end)}`;
}

const slotText = (slot) => (slot === 'day' ? '白天（07:00–19:00）' : slot === 'night' ? '夜晚（19:00–07:00）' : '全天');

function slotChip(slot) {
    if (slot === 'day') return '<span class="chip chip-day"><i class="fa-solid fa-sun"></i>白天</span>';
    if (slot === 'night') return '<span class="chip chip-night"><i class="fa-solid fa-moon"></i>夜晚</span>';
    return '<span class="chip chip-all"><i class="fa-solid fa-circle-half-stroke"></i>全天</span>';
}

function setPhaseChip(el, phase) {
    el.className = 'chip ' + (phase === 'day' ? 'chip-day' : 'chip-night');
    el.innerHTML = phase === 'day' ? '<i class="fa-solid fa-sun"></i>白天' : '<i class="fa-solid fa-moon"></i>夜晚';
}

// "GMT+8 | 10:50 AM": 12-hour clock with AM / PM
function fmtClock(g) {
    const h12 = g.hour % 12 || 12;
    return `GMT+8 | ${h12}:${pad2(g.minute)} ${g.hour < 12 ? 'AM' : 'PM'}`;
}

// ----- "showing right now" -----
function renderLive() {
    const now = new Date();
    const g = Store.gmt8(now);
    const pick = Store.pickHero(heroSource(), now);
    const url = Store.resolve(pick.img);
    if ($('liveImg').getAttribute('src') !== url) $('liveImg').src = url;
    $('liveClock').textContent = fmtClock(g);
    setPhaseChip($('livePhase'), pick.phase);
    $('liveReason').innerHTML = `今天是 <b>${esc(fmtDay(g.ymd))}</b>。${esc(pick.reason)}。`
        + `<br><span class="text-gray-400">到了 07:00、19:00 或午夜，网站会自动换图，访客不用刷新页面。</span>`;
    return pick;
}

// ----- preview another date / time -----
function segValue(el) {
    const on = el.querySelector('[aria-pressed="true"]');
    return on ? on.dataset.value : null;
}

function setSeg(el, value) {
    el.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === value)));
}

function renderSim() {
    const ymd = $('simDate').value;
    const phase = segValue($('simPhase'));
    if (!ymd || !phase) return;
    const pick = Store.pickHero(heroSource(), new Date(), { ymd, phase });
    $('simImg').src = Store.resolve(pick.img);
    $('simReason').innerHTML = `<b>${esc(fmtDay(ymd))} · ${phase === 'day' ? '白天' : '夜晚'}</b><br>${esc(pick.reason)}`;
}

function initSim() {
    if ($('simDate').value) return;
    const g = Store.gmt8();
    $('simDate').value = g.ymd;
    setSeg($('simPhase'), Store.phaseOf(g.hour));
}

$('simDate').addEventListener('input', renderSim);
$('simPhase').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    setSeg($('simPhase'), btn.dataset.value);
    renderSim();
});

// ----- the list -----
function renderBanners() {
    $('bannerCount').textContent = banners.length;
    const live = Store.pickHero(heroSource()).banner;
    $('bannerList').innerHTML = banners.length === 0
        ? `<div class="card sm:col-span-2 text-center py-8">
               <div class="text-3xl text-gold-500 mb-2"><i class="fa-regular fa-images"></i></div>
               <p class="text-sm font-bold">还没有活动横幅</p>
               <p class="text-xs text-gray-500 mt-1 leading-relaxed">点「新增横幅」，可以让节日、周末显示不同的图，<br>也可以让白天和夜晚显示不同的图。</p>
           </div>`
        : banners.map((b) => {
            const isLive = !!live && live.id === b.id;
            return `
            <div class="banner-card ${isLive ? 'is-live' : ''} ${b.active ? '' : 'is-off'}">
                <div class="banner-thumb">
                    <img src="${esc(Store.resolve(b.img))}" alt="" loading="lazy" onerror="this.removeAttribute('src')">
                    <div class="chips">
                        ${isLive ? '<span class="chip chip-live"><i class="fa-solid fa-circle-play"></i>正在显示</span>' : ''}
                        ${slotChip(b.slot)}
                        ${b.active ? '' : '<span class="chip chip-off">已停用</span>'}
                    </div>
                </div>
                <div class="p-3.5 space-y-3">
                    <div>
                        <h3 class="text-sm font-bold leading-snug">${esc(b.title || '未命名横幅')}</h3>
                        <p class="text-xs text-gray-500 mt-0.5"><i class="fa-regular fa-calendar mr-1"></i>${esc(dateText(b.startDate, b.endDate))} · ${esc(slotText(b.slot))}</p>
                    </div>
                    <div class="flex items-center justify-between gap-2">
                        <label class="flex items-center gap-2 text-xs font-semibold text-gray-600 cursor-pointer">
                            <input type="checkbox" class="switch" data-toggle="${b.id}" ${b.active ? 'checked' : ''} aria-label="启用或停用">
                            ${b.active ? '启用中' : '已停用'}
                        </label>
                        <div class="flex gap-2">
                            <button class="btn-ghost !py-1.5 !px-3" data-edit="${b.id}"><i class="fa-solid fa-pen mr-1"></i>编辑</button>
                            <button class="btn-danger !py-1.5 !px-3" data-del="${b.id}" aria-label="删除"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');
}

function renderHeroPanel() {
    initSim();
    renderLive();
    renderSim();
    renderBanners();
}

// keep the clock, the "live" badge and the preview up to date while the page stays open
setInterval(() => { renderLive(); renderBanners(); }, 20000);

const bannerBody = (b, patch = {}) => ({
    title: b.title, img: b.img, slot: b.slot, startDate: b.startDate, endDate: b.endDate, active: b.active, ...patch
});

$('bannerList').addEventListener('change', (e) => {
    const t = e.target.closest('[data-toggle]');
    if (!t) return;
    const b = banners.find((x) => x.id === Number(t.dataset.toggle));
    if (!b) return;
    run(() => api('PUT', `admin/hero-banners/${b.id}`, bannerBody(b, { active: t.checked })), t.checked ? '已启用这张横幅' : '已停用这张横幅');
});

$('bannerList').addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) {
        openBannerSheet(banners.find((x) => x.id === Number(edit.dataset.edit)));
    } else if (del) {
        const b = banners.find((x) => x.id === Number(del.dataset.del));
        if (b && confirm(`确定删除横幅「${b.title || '未命名横幅'}」吗？此操作无法撤销。`)) {
            run(() => api('DELETE', `admin/hero-banners/${b.id}`), '横幅已删除');
        }
    }
});

// ----- the add / edit sheet -----
const addDays = (ymd, n) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

function bannerFormState() {
    const daily = $('bn-daily').checked;
    return {
        title: $('bn-title').value.trim(),
        img: $('bn-img').value,
        slot: segValue($('bn-slot')) || 'all',
        daily,
        startDate: daily ? null : ($('bn-start').value || null),
        endDate: daily ? null : ($('bn-end').value || null),
        active: $('bn-active').checked
    };
}

function updateBannerSummary() {
    const s = bannerFormState();
    const lines = [];
    if (!s.daily && !s.startDate && !s.endDate) {
        lines.push('请选一个日期范围，或者打开「每天都显示」。');
    } else if (s.startDate && s.endDate && s.endDate < s.startDate) {
        lines.push('<b class="text-red-600">结束日期不能早于开始日期。</b>');
    } else {
        lines.push(`将在 <b>${esc(dateText(s.startDate, s.endDate))}</b> 的 <b>${esc(slotText(s.slot))}</b> 显示（GMT+8）。`);
    }
    if (!s.active) lines.push('现在是「停用」状态，保存后不会显示。');
    if (!s.img) lines.push('还没有选择照片。');
    lines.push('<span class="text-[11px] text-gray-400">同一时间有多张横幅时，「指定日期 + 指定时段」的那张优先。</span>');
    $('bn-summary').innerHTML = lines.join('<br>');
}

function setDatesMode(daily) {
    $('bn-daily').checked = daily;
    $('bn-dates').classList.toggle('hidden', daily);
}

function openBannerSheet(b) {
    editingBannerId = b ? b.id : null;
    $('bannerSheetTitle').textContent = b ? '编辑横幅' : '新增横幅';
    const v = b || { title: '', img: '', slot: 'all', startDate: null, endDate: null, active: true };
    $('bn-title').value = v.title;
    setImageField('bn-img', v.img);
    setSeg($('bn-slot'), v.slot);
    const daily = !v.startDate && !v.endDate;
    setDatesMode(daily);
    $('bn-start').value = v.startDate || '';
    $('bn-end').value = v.endDate || '';
    $('bn-active').checked = v.active;
    updateBannerSummary();
    showSheet();
}

function showSheet(id = 'bannerSheet') {
    const wrap = $(id);
    wrap.classList.remove('hidden', 'is-closing');
    document.body.classList.add('sheet-open');
}

function hideSheet(id = 'bannerSheet') {
    const wrap = $(id);
    if (wrap.classList.contains('hidden') || wrap.classList.contains('is-closing')) return;
    document.body.classList.remove('sheet-open');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { wrap.classList.add('hidden'); return; }
    wrap.classList.add('is-closing');
    const sheet = wrap.firstElementChild;
    let done = false;
    const finish = () => {
        if (done || !wrap.classList.contains('is-closing')) return;
        done = true;
        wrap.classList.add('hidden');
        wrap.classList.remove('is-closing');
    };
    sheet.addEventListener('animationend', (e) => { if (e.target === sheet) finish(); });
    setTimeout(finish, 450);
}

$('bannerAdd').addEventListener('click', () => openBannerSheet(null));
$('bannerFab').addEventListener('click', () => openBannerSheet(null));
$('bannerSheetClose').addEventListener('click', () => hideSheet());
$('bannerCancel').addEventListener('click', () => hideSheet());
$('bannerSheet').addEventListener('click', (e) => { if (e.target === $('bannerSheet')) hideSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideSheet('bannerSheet'); hideSheet('listingSheet'); } });

$('bn-slot').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    setSeg($('bn-slot'), btn.dataset.value);
    updateBannerSummary();
});

$('bn-daily').addEventListener('change', () => {
    setDatesMode($('bn-daily').checked);
    updateBannerSummary();
});

['bn-title', 'bn-start', 'bn-end', 'bn-active'].forEach((id) => $(id).addEventListener('input', updateBannerSummary));
$('bn-start').addEventListener('input', () => {
    // keep the end date from being earlier than the start date
    if ($('bn-end').value && $('bn-end').value < $('bn-start').value) $('bn-end').value = $('bn-start').value;
    updateBannerSummary();
});
// the picture field changes asynchronously after an upload: refresh the summary when it does
new MutationObserver(updateBannerSummary).observe($('bn-img-wrap'), { subtree: true, attributes: true, attributeFilter: ['src'] });

$('bn-presets').addEventListener('click', (e) => {
    const p = e.target.closest('.preset');
    if (!p) return;
    const today = Store.gmt8().ymd;
    const [y, m] = today.split('-').map(Number);
    const ranges = {
        today: [today, today],
        tomorrow: [addDays(today, 1), addDays(today, 1)],
        week: [today, addDays(today, 6)],
        month: [`${y}-${pad2(m)}-01`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)]
    };
    [$('bn-start').value, $('bn-end').value] = ranges[p.dataset.preset];
    updateBannerSummary();
});

$('bannerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = bannerFormState();
    if (!s.img) { toast('请先选择一张横幅照片', true); return; }
    if (!s.daily && !s.startDate && !s.endDate) { toast('请选一个日期范围，或者打开「每天都显示」', true); return; }
    if (s.startDate && s.endDate && s.endDate < s.startDate) { toast('结束日期不能早于开始日期', true); return; }

    const body = { title: s.title, img: s.img, slot: s.slot, startDate: s.startDate, endDate: s.endDate, active: s.active };
    const id = editingBannerId;
    const ok = await run(
        () => (id ? api('PUT', `admin/hero-banners/${id}`, body) : api('POST', 'admin/hero-banners', body)),
        id ? '横幅已更新' : '横幅已添加'
    );
    if (ok) hideSheet();
});

// ---------- listings ----------
let editingListingId = null;
// ----- listing photos: several pictures per listing, the first one is the cover -----
const MAX_PHOTOS = 20;
let lfPhotos = [];
let lfUploading = 0;

$('lf-photos-wrap').innerHTML = `
    <div class="space-y-2">
        <span class="block text-[11px] font-bold text-gray-700">房源照片 <span id="lf-photo-count" class="text-gray-400 font-normal"></span></span>
        <div id="lf-photo-grid" class="photo-grid"></div>
        <div class="flex gap-2">
            <input id="lf-photo-url" type="url" placeholder="或粘贴图片链接，再点「添加」" class="flex-1 min-w-0 text-xs px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:border-gold-500">
            <button type="button" id="lf-photo-url-add" class="btn-ghost flex-shrink-0">添加</button>
        </div>
        <p class="text-[11px] text-gray-400 leading-relaxed">第一张是封面（显示在房源卡片上）。用 ‹ › 调整顺序，★ 设为封面。可以一次选多张。</p>
    </div>`;

function renderLfPhotos() {
    const total = lfPhotos.length;
    $('lf-photo-grid').innerHTML = lfPhotos.map((p, i) => `
        <div class="photo-tile ${i === 0 ? 'is-cover' : ''}">
            <img src="${esc(Store.resolve(p))}" alt="" onerror="this.removeAttribute('src')">
            ${i === 0 ? '<span class="cover-badge">封面</span>' : ''}
            <button type="button" class="photo-del" data-act="del" data-i="${i}" aria-label="删除这张照片"><i class="fa-solid fa-xmark"></i></button>
            <div class="photo-bar">
                <button type="button" data-act="left" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="往前移"><i class="fa-solid fa-chevron-left"></i></button>
                ${i === 0 ? '' : `<button type="button" data-act="cover" data-i="${i}" aria-label="设为封面"><i class="fa-solid fa-star"></i></button>`}
                <button type="button" data-act="right" data-i="${i}" ${i === total - 1 ? 'disabled' : ''} aria-label="往后移"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
        </div>`).join('')
        + Array.from({ length: lfUploading }, () => '<div class="photo-tile is-loading" aria-label="上传中"><span class="photo-spinner"></span></div>').join('')
        + (total + lfUploading < MAX_PHOTOS
            ? '<label class="photo-add"><i class="fa-solid fa-plus"></i><span>添加照片</span><input id="lf-photo-file" type="file" accept="image/*" multiple class="hidden"></label>'
            : '');
    $('lf-photo-count').textContent = `（${total} / ${MAX_PHOTOS}）`;
    $('lf-gallery-preview').innerHTML = total
        ? Store.galleryHtml(lfPhotos, { clickable: false })
        : '<div class="img-empty" style="display:flex"><i class="fa-regular fa-image"></i><span>还没有照片</span></div>';
}

async function addLfFiles(files) {
    const room = MAX_PHOTOS - lfPhotos.length - lfUploading;
    const list = [...files].slice(0, Math.max(0, room));
    if (files.length > list.length) toast(`最多 ${MAX_PHOTOS} 张，多出来的没有添加`, true);
    lfUploading += list.length;
    renderLfPhotos();
    for (const file of list) {            // one after another: kind to the server and keeps the order
        try {
            lfPhotos.push(await uploadImage(file, 1400));
        } catch (err) {
            if (!(err instanceof UnauthorizedError)) toast(err.message, true);
        } finally {
            lfUploading--;
            renderLfPhotos();
        }
    }
}

$('lf-photo-grid').addEventListener('change', (e) => {
    if (e.target.id === 'lf-photo-file') { addLfFiles(e.target.files); e.target.value = ''; }
});

$('lf-photo-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const i = Number(btn.dataset.i);
    const act = btn.dataset.act;
    if (act === 'del') lfPhotos.splice(i, 1);
    else if (act === 'left' && i > 0) [lfPhotos[i - 1], lfPhotos[i]] = [lfPhotos[i], lfPhotos[i - 1]];
    else if (act === 'right' && i < lfPhotos.length - 1) [lfPhotos[i + 1], lfPhotos[i]] = [lfPhotos[i], lfPhotos[i + 1]];
    else if (act === 'cover' && i > 0) lfPhotos.unshift(lfPhotos.splice(i, 1)[0]);
    renderLfPhotos();
});

$('lf-photo-url-add').addEventListener('click', () => {
    const url = $('lf-photo-url').value.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) { toast('请粘贴以 http:// 或 https:// 开头的图片链接', true); return; }
    if (lfPhotos.includes(url)) { toast('这张照片已经添加过了', true); return; }
    if (lfPhotos.length + lfUploading >= MAX_PHOTOS) { toast(`最多 ${MAX_PHOTOS} 张照片`, true); return; }
    lfPhotos.push(url);
    $('lf-photo-url').value = '';
    renderLfPhotos();
});

function formatPrice(p) {
    if (p.type === 'rent') return `RM ${Number(p.priceRM).toLocaleString()} / 月`;
    // six-digit sale prices are shown in thousands (790000 -> 790 千), like the site
    if (p.priceRM >= 100000 && p.priceRM < 1000000) return `RM ${Math.floor(p.priceRM / 100) / 10} 千`;
    return `RM ${(p.priceRM / 10000).toFixed(0)} 万`;
}

function renderListings() {
    $('listingCount').textContent = content.properties.length;
    $('listingList').innerHTML = content.properties.length === 0
        ? '<p class="text-sm text-gray-400 sm:col-span-2 py-8 text-center">还没有房源，点击右上角「新增房源」。</p>'
        : content.properties.map(p => `
            <div class="item-card" data-id="${p.id}">
                <img src="${esc(Store.resolve(p.img))}" alt="" onerror="this.removeAttribute('src')">
                <div class="min-w-0 flex-1 flex flex-col">
                    <div class="flex items-center gap-2 mb-0.5">
                        <span class="text-[10px] font-bold px-1.5 py-0.5 rounded text-white ${p.type === 'rent' ? 'bg-gold-500' : 'bg-charcoal-900'}">${p.type === 'rent' ? '出租' : '出售'}</span>
                        ${p.closed ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">${p.type === 'rent' ? '已出租' : '已售出'}</span>` : ''}
                        <span class="text-[11px] text-gray-400 truncate">${esc(p.location.zh)}</span>
                        ${(p.photos || []).length > 1 ? `<span class="text-[11px] text-gray-400 flex-shrink-0"><i class="fa-regular fa-images mr-0.5"></i>${p.photos.length}</span>` : ''}
                    </div>
                    <h3 class="text-sm font-bold leading-snug line-clamp-2">${esc(p.title.zh)}</h3>
                    <p class="text-xs font-bold text-gold-700 mt-0.5">${formatPrice(p)}</p>
                    <div class="mt-auto pt-2 flex justify-end gap-2">
                        <button class="btn-ghost !py-1 !px-3" data-edit="${p.id}"><i class="fa-solid fa-pen mr-1"></i>编辑</button>
                        <button class="btn-danger !py-1 !px-3" data-delete="${p.id}"><i class="fa-solid fa-trash mr-1"></i>删除</button>
                    </div>
                </div>
                <button type="button" class="drag-handle" aria-label="拖动调整顺序（也可以用键盘上下键）" title="按住拖动调整顺序"><i class="fa-solid fa-grip-lines" aria-hidden="true"></i></button>
            </div>`).join('');
    $('listingSortHint').classList.toggle('hidden', content.properties.length < 2);
}

// ----- drag to re-order the listings (mouse, finger or keyboard) -----
// Hold the three-line handle on a row and move it up or down; on release the new order is saved and the site follows it.
(() => {
    const list = $('listingList');
    let drag = null;          // { card, base0, pointer0, lastY, raf }
    let saving = Promise.resolve();

    const orderIds = () => [...list.querySelectorAll('.item-card[data-id]')].map(c => Number(c.dataset.id));
    const listTop = () => list.getBoundingClientRect().top;

    // move the row that gets out of the way with a short slide instead of a jump
    function slide(other, move) {
        const before = other.getBoundingClientRect().top;
        move();
        const delta = before - other.getBoundingClientRect().top;
        if (delta && other.animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            other.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 160, easing: 'ease-out' });
        }
    }

    function place() {
        if (!drag) return;
        const { card } = drag;
        const pointer = drag.lastY - listTop();
        const wanted = drag.base0 + (pointer - drag.pointer0);               // where the dragged row should be, in list coordinates
        // swap places with a neighbour once the dragged row's middle passes the neighbour's middle
        for (;;) {
            const centre = wanted + card.offsetHeight / 2;
            const prev = card.previousElementSibling;
            const next = card.nextElementSibling;
            if (prev && centre < prev.offsetTop + prev.offsetHeight / 2) slide(prev, () => list.insertBefore(card, prev));
            else if (next && centre > next.offsetTop + next.offsetHeight / 2) slide(next, () => list.insertBefore(next, card));
            else break;
        }
        card.style.transform = `translateY(${wanted - card.offsetTop}px)`;
    }

    function autoScroll() {
        if (!drag) return;
        const edge = 70;
        const y = drag.lastY;
        if (y < edge + 60) window.scrollBy(0, -Math.ceil((edge + 60 - y) / 5));              // 60px ~ the sticky header
        else if (y > innerHeight - edge) window.scrollBy(0, Math.ceil((y - (innerHeight - edge)) / 5));
        place();
        drag.raf = requestAnimationFrame(autoScroll);
    }

    function save(ids, before) {
        saving = saving.then(async () => {
            try {
                await api('PUT', 'admin/properties/order', { ids });
                const byId = new Map(content.properties.map(p => [p.id, p]));
                content.properties = ids.map(id => byId.get(id)).filter(Boolean);
                toast('顺序已保存，前台已同步');
            } catch (err) {
                if (!(err instanceof UnauthorizedError)) toast(err.message, true);
                renderListings();       // put the rows back the way they really are
            }
        });
        return saving;
    }

    list.addEventListener('pointerdown', (e) => {
        const handle = e.target.closest('.drag-handle');
        if (!handle || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const card = handle.closest('.item-card');
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        drag = { card, handle, id: e.pointerId, base0: card.offsetTop, pointer0: e.clientY - listTop(), lastY: e.clientY, before: orderIds().join(), raf: 0 };
        card.classList.add('is-dragging');
        document.body.classList.add('is-sorting');
        drag.raf = requestAnimationFrame(autoScroll);
    });

    list.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        drag.lastY = e.clientY;
        place();
    });

    const finish = (e, cancelled) => {
        if (!drag || e.pointerId !== drag.id) return;
        const { card, before } = drag;
        cancelAnimationFrame(drag.raf);
        drag = null;
        card.classList.remove('is-dragging');
        document.body.classList.remove('is-sorting');
        card.style.transition = 'transform 0.18s ease';
        card.style.transform = 'translateY(0)';
        setTimeout(() => { card.style.transition = ''; card.style.transform = ''; }, 200);
        if (cancelled) { renderListings(); return; }
        const ids = orderIds();
        if (ids.join() !== before) save(ids);
    };
    list.addEventListener('pointerup', (e) => finish(e, false));
    list.addEventListener('pointercancel', (e) => finish(e, true));

    // keyboard: focus the handle, then arrow up / down moves the row one place
    let keyTimer = 0;
    list.addEventListener('keydown', (e) => {
        const handle = e.target.closest('.drag-handle');
        if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        const card = handle.closest('.item-card');
        const sibling = e.key === 'ArrowUp' ? card.previousElementSibling : card.nextElementSibling;
        if (!sibling) return;
        if (e.key === 'ArrowUp') list.insertBefore(card, sibling); else list.insertBefore(sibling, card);
        handle.focus();
        clearTimeout(keyTimer);
        keyTimer = setTimeout(() => save(orderIds()), 500);
    });
})();

// Bedrooms / bathrooms: two dropdowns. The Chinese and English texts shown on the site are generated from them.
const BEDROOM_OPTIONS = [
    ['studio', '开放式 Studio'], ['1', '1 房'], ['2', '2 房'], ['3', '3 房'], ['3+1', '3+1 房'], ['4', '4 房'],
    ['4+1', '4+1 房'], ['5', '5 房'], ['5+1', '5+1 房'], ['6', '6 房'], ['7+', '7 房或以上']
];
const BATHROOM_OPTIONS = [['1', '1 卫'], ['2', '2 卫'], ['3', '3 卫'], ['4', '4 卫'], ['5', '5 卫'], ['6', '6 卫'], ['7+', '7 卫或以上']];

function bedsText(bedrooms, bathrooms) {
    return {
        zh: `${bedrooms === 'studio' ? '开放式' : bedrooms + ' 房'} ${bathrooms} 卫`,
        en: `${bedrooms === 'studio' ? 'Studio' : bedrooms + ' Bed'} ${bathrooms} Bath`
    };
}

function fillSelect(el, placeholder, options) {
    el.innerHTML = `<option value="" disabled selected>${placeholder}</option>`
        + options.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('');
}
fillSelect($('lf-bedrooms'), '几房', BEDROOM_OPTIONS);
fillSelect($('lf-bathrooms'), '几卫', BATHROOM_OPTIONS);

let legacyBedsNote = '';
function updateBedsPreview() {
    const b = $('lf-bedrooms').value;
    const t = $('lf-bathrooms').value;
    if (b && t) {
        const text = bedsText(b, t);
        $('lf-beds-preview').innerHTML = `前台会自动显示：<b>${esc(text.zh)}</b> ／ <b>${esc(text.en)}</b>`;
    } else {
        $('lf-beds-preview').textContent = legacyBedsNote || '选好几房、几卫，前台会自动显示中文和英文。';
    }
}
$('lf-bedrooms').addEventListener('change', updateBedsPreview);
$('lf-bathrooms').addEventListener('change', updateBedsPreview);

// ----- renovation status: a dropdown; an older free-text value is kept as one extra choice until it is changed -----
let lfLegacyStatus = null;
function fillRenovation(status) {
    const sel = $('lf-status');
    const known = RENOVATION_OPTIONS.findIndex(o => o.zh === (status.zh || '') && o.en === (status.en || ''));
    lfLegacyStatus = !status.zh && !status.en || known >= 0 ? null : { zh: status.zh || '', en: status.en || '' };
    sel.innerHTML = RENOVATION_OPTIONS.map((o, i) => `<option value="${i}">${esc(o.zh)}</option>`).join('')
        + (lfLegacyStatus ? `<option value="legacy">${esc(lfLegacyStatus.zh || lfLegacyStatus.en)}</option>` : '');
    sel.value = lfLegacyStatus ? 'legacy' : String(known >= 0 ? known : 0);
}
function selectedRenovation() {
    const v = $('lf-status').value;
    return v === 'legacy' && lfLegacyStatus ? lfLegacyStatus : RENOVATION_OPTIONS[Number(v)] || RENOVATION_OPTIONS[0];
}

// ----- highlight tags: tick ready-made ones (public/facilities.js) and/or add your own -----
const MAX_HIGHLIGHTS = 12;
let lfHighlights = [];   // { key?, zh, en }; a tag with a key comes from the list, the others are custom
let lfHlFilter = '';

// an older tag that says the same thing as a list item (same English or Chinese text) becomes that list item
function matchFacility(h) {
    if (h.key && FACILITY_BY_KEY[h.key]) return h.key;
    const en = (h.en || '').trim().toLowerCase();
    const zh = (h.zh || '').trim();
    const f = FACILITIES.find(x => (en && x.en.toLowerCase() === en) || (zh && x.zh === zh));
    return f ? f.key : null;
}
function loadHighlights(list) {
    const seen = new Set();
    lfHighlights = [];
    (list || []).forEach(h => {
        const key = matchFacility(h);
        if (key) {
            if (seen.has(key)) return;
            seen.add(key);
            lfHighlights.push({ key, zh: FACILITY_BY_KEY[key].zh, en: FACILITY_BY_KEY[key].en });
        } else {
            lfHighlights.push({ zh: h.zh || '', en: h.en || '' });
        }
    });
}

function renderLfHighlights() {
    const chosen = new Set(lfHighlights.filter(h => h.key).map(h => h.key));
    const q = lfHlFilter.trim().toLowerCase();
    const shown = FACILITIES.filter(f => !q || f.en.toLowerCase().includes(q) || f.zh.includes(q));
    $('lf-hl-picker').innerHTML = shown.length ? shown.map(f => `
        <button type="button" class="hl-chip ${chosen.has(f.key) ? 'is-on' : ''}" data-fac="${f.key}" aria-pressed="${chosen.has(f.key)}">
            <i class="fa-solid ${f.icon}" aria-hidden="true"></i><span>${esc(f[lfLang])}</span><i class="fa-solid fa-check hl-tick" aria-hidden="true"></i>
        </button>`).join('') : '<p class="text-[11px] text-gray-400 py-2">没有找到这个标签，可以在下面「自定义标签」里自己加。</p>';

    const other = lfLang === 'zh' ? 'en' : 'zh';
    const customs = lfHighlights.map((h, i) => ({ h, i })).filter(x => !x.h.key);
    $('lf-highlights').innerHTML = customs.length ? customs.map(({ h, i }) => `
        <div class="hl-row">
            <i class="fa-solid fa-tag" aria-hidden="true"></i>
            <input data-hl="${i}" value="${esc(h[lfLang])}" maxlength="40" placeholder="${lfLang === 'zh' ? '中文标签，例如：私人泳池' : 'English tag, e.g. Private pool'}"
                title="${esc(h[other] ? (lfLang === 'zh' ? 'English: ' : '中文：') + h[other] : '')}">
            <button type="button" class="hl-del" data-hl-del="${i}" aria-label="删除这个标签"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('') : '';
    const count = lfHighlights.filter(h => h.zh.trim() || h.en.trim() || h.key).length;
    $('lf-hl-count').textContent = `已选 ${count} / ${MAX_HIGHLIGHTS}`;
    $('lf-hl-count').classList.toggle('is-full', count >= MAX_HIGHLIGHTS);
}

$('lf-hl-picker').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-fac]');
    if (!chip) return;
    const key = chip.dataset.fac;
    const at = lfHighlights.findIndex(h => h.key === key);
    if (at >= 0) {
        lfHighlights.splice(at, 1);
    } else {
        if (lfHighlights.length >= MAX_HIGHLIGHTS) { toast(`最多 ${MAX_HIGHLIGHTS} 个标签`, true); return; }
        lfHighlights.push({ key, zh: FACILITY_BY_KEY[key].zh, en: FACILITY_BY_KEY[key].en });
    }
    renderLfHighlights();
    updateEnDot();
});
$('lf-hl-search').addEventListener('input', (e) => { lfHlFilter = e.target.value; renderLfHighlights(); });
$('lf-highlights').addEventListener('input', (e) => {
    const i = e.target.dataset.hl;
    if (i === undefined) return;
    lfHighlights[Number(i)][lfLang] = e.target.value;
    $('lf-hl-count').textContent = `已选 ${lfHighlights.filter(h => h.zh.trim() || h.en.trim() || h.key).length} / ${MAX_HIGHLIGHTS}`;
    updateEnDot();
});
$('lf-highlights').addEventListener('click', (e) => {
    const del = e.target.closest('[data-hl-del]');
    if (!del) return;
    lfHighlights.splice(Number(del.dataset.hlDel), 1);
    renderLfHighlights();
    updateEnDot();
});
$('lf-hl-add').addEventListener('click', () => {
    if (lfHighlights.length >= MAX_HIGHLIGHTS) { toast(`最多 ${MAX_HIGHLIGHTS} 个标签`, true); return; }
    lfHighlights.push({ zh: '', en: '' });
    renderLfHighlights();
    const inputs = $('lf-highlights').querySelectorAll('input');
    inputs[inputs.length - 1].focus();
    updateEnDot();
});

function openListingForm(p) {
    editingListingId = p ? p.id : null;
    $('listingFormTitle').textContent = p ? '编辑房源' : '新增房源';
    const v = p || {
        title: {}, type: 'rent', priceRM: '', areaSqft: '', area: 'KLCC', beds: {}, bedrooms: '', bathrooms: '',
        location: AREA_LABELS['KLCC'], address: '', status: {}, desc: {}, img: ''
    };
    $('lf-title-zh').value = v.title.zh || '';
    $('lf-title-en').value = v.title.en || '';
    $('lf-type').value = v.type;
    $('lf-price').value = v.priceRM;
    $('lf-sqft').value = v.areaSqft;
    $('lf-area').value = v.area;
    $('lf-bedrooms').value = v.bedrooms || '';
    $('lf-bathrooms').value = v.bathrooms || '';
    // an old listing whose room text could not be read: tell the owner what it said so they can pick again
    legacyBedsNote = p && !(p.bedrooms && p.bathrooms) && p.beds && p.beds.zh
        ? `原来的房型是「${p.beds.zh}」，请重新选择几房、几卫。` : '';
    updateBedsPreview();
    $('lf-loc-zh').value = v.location.zh || '';
    $('lf-loc-en').value = v.location.en || '';
    $('lf-address').value = v.address || '';
    fillRenovation(v.status);
    loadHighlights(v.highlights);
    lfHlFilter = '';
    $('lf-hl-search').value = '';
    $('lf-closed').checked = !!v.closed;
    $('lf-desc-zh').value = v.desc.zh || '';
    $('lf-desc-en').value = v.desc.en || '';
    lfPhotos = p ? [...(p.photos && p.photos.length ? p.photos : [p.img])] : [];
    lfUploading = 0;
    $('lf-photo-url').value = '';
    renderLfPhotos();
    setLfType(v.type);
    updatePriceFmt();
    setLfLang('zh');         // also draws the highlight tags
    showSheet('listingSheet');
    $('listingForm').scrollTop = 0;
}

function closeListingForm() {
    hideSheet('listingSheet');
    editingListingId = null;
}

// ----- the editor looks like the site: rent/sale badge, price line and the language boxes -----
function setLfType(type) {
    $('lf-type').value = type;
    const rent = type === 'rent';
    $('lf-type-switch').checked = !rent;
    $('lf-type-rent-label').classList.toggle('is-on', rent);
    $('lf-type-sale-label').classList.toggle('is-on', !rent);
    const badge = $('lf-type-badge');
    badge.textContent = rent ? '出租 · 点此切换' : '出售 · 点此切换';
    badge.classList.toggle('is-sale', !rent);
    $('lf-price-unit').textContent = rent ? '/ 月' : '';
    $('lf-closed-title').textContent = rent ? '标记为已出租' : '标记为已售出';
    $('lf-closed-sub').textContent = `打开后，前台这个房源会显示「${rent ? '已出租' : '已售出'}」，并且不能再预约看房。`;
}
$('lf-type-badge').addEventListener('click', () => setLfType($('lf-type').value === 'rent' ? 'sale' : 'rent'));

function updatePriceFmt() {
    const n = Number($('lf-price').value);
    $('lf-price-fmt').textContent = n > 0 ? `RM ${n.toLocaleString('en-US')}${$('lf-type').value === 'rent' ? ' / 月' : ''}` : '';
}
$('lf-price').addEventListener('input', updatePriceFmt);
$('lf-type-badge').addEventListener('click', updatePriceFmt);
$('lf-type-switch').addEventListener('change', (e) => { setLfType(e.target.checked ? 'sale' : 'rent'); updatePriceFmt(); });

const LF_EN_IDS = ['lf-title-en', 'lf-loc-en', 'lf-desc-en'];
let lfLang = 'zh';
function updateEnDot() {
    $('lfEnDot').classList.toggle('is-off', LF_EN_IDS.every(id => $(id).value.trim()) && lfHighlights.every(h => h.key || h.en.trim() || !h.zh.trim()));
}
function setLfLang(lang) {
    lfLang = lang;
    document.querySelectorAll('#listingForm [data-lang]').forEach(el => el.classList.toggle('is-off', el.dataset.lang !== lang));
    document.querySelectorAll('#lfLang .seg-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === lang)));
    renderLfHighlights();
    updateEnDot();
}
$('lfLang').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (b) setLfLang(b.dataset.value);
});
LF_EN_IDS.forEach(id => $(id).addEventListener('input', updateEnDot));

$('listingAdd').addEventListener('click', () => openListingForm(null));
$('listingCancel').addEventListener('click', closeListingForm);
$('listingCancel2').addEventListener('click', closeListingForm);
$('listingSheet').addEventListener('click', (e) => { if (e.target === $('listingSheet')) closeListingForm(); });

// Changing the area fills in that area's default display name
$('lf-area').addEventListener('change', (e) => {
    const label = AREA_LABELS[e.target.value];
    $('lf-loc-zh').value = label.zh;
    $('lf-loc-en').value = label.en;
});

$('listingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (lfUploading > 0) { toast('照片还在上传，请稍等一下', true); return; }
    if (!lfPhotos.length) { toast('请至少添加一张房源照片', true); return; }

    const area = $('lf-area').value;
    const data = {
        title: { zh: $('lf-title-zh').value, en: $('lf-title-en').value },
        type: $('lf-type').value,
        priceRM: Number($('lf-price').value),
        areaSqft: Number($('lf-sqft').value),
        bedrooms: $('lf-bedrooms').value,
        bathrooms: $('lf-bathrooms').value,
        area,
        location: {
            zh: $('lf-loc-zh').value.trim() || AREA_LABELS[area].zh,
            en: $('lf-loc-en').value.trim() || AREA_LABELS[area].en
        },
        address: $('lf-address').value,
        photos: lfPhotos,
        status: selectedRenovation(),
        highlights: lfHighlights.filter(h => h.zh.trim() || h.en.trim()),
        closed: $('lf-closed').checked,
        desc: { zh: $('lf-desc-zh').value, en: $('lf-desc-en').value }
    };

    const editing = editingListingId;
    const ok = await run(
        () => editing ? api('PUT', `admin/properties/${editing}`, data) : api('POST', 'admin/properties', data),
        editing ? '房源已更新' : '房源已新增'
    );
    if (ok) closeListingForm();
});

$('listingList').addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-delete]');
    if (edit) {
        openListingForm(content.properties.find(p => p.id === Number(edit.dataset.edit)));
    } else if (del) {
        const p = content.properties.find(x => x.id === Number(del.dataset.delete));
        if (p && confirm(`确定删除房源「${p.title.zh}」吗？此操作无法撤销。`)) {
            run(() => api('DELETE', `admin/properties/${p.id}`), '房源已删除');
        }
    }
});

// ---------- team ----------
let editingTeamId = null;
$('tf-img-wrap').innerHTML = imageFieldHtml('tf-img', '头像', 'aspect-square w-32 !rounded-full');
bindImageField('tf-img', 400);

function renderTeam() {
    $('teamCount').textContent = content.team.length;
    $('teamList').innerHTML = content.team.length === 0
        ? '<p class="text-sm text-gray-400 sm:col-span-2 py-8 text-center">还没有顾问，点击右上角「新增顾问」。</p>'
        : content.team.map(t => `
            <div class="item-card round">
                <img src="${esc(Store.resolve(t.img))}" alt="" onerror="this.removeAttribute('src')">
                <div class="min-w-0 flex-1 flex flex-col">
                    <h3 class="text-sm font-bold truncate">${esc(t.name)}</h3>
                    <p class="text-xs text-gold-700 font-medium truncate">${esc(t.role.zh)}</p>
                    <p class="text-[11px] text-gray-400 line-clamp-2">${esc(t.meta.zh)}</p>
                    <div class="mt-auto pt-2 flex justify-end gap-2">
                        <button class="btn-ghost !py-1 !px-3" data-edit="${t.id}"><i class="fa-solid fa-pen mr-1"></i>编辑</button>
                        <button class="btn-danger !py-1 !px-3" data-delete="${t.id}"><i class="fa-solid fa-trash mr-1"></i>删除</button>
                    </div>
                </div>
            </div>`).join('');
}

function openTeamForm(t) {
    editingTeamId = t ? t.id : null;
    $('teamFormTitle').textContent = t ? '编辑顾问' : '新增顾问';
    const v = t || { name: '', role: {}, meta: {}, img: '' };
    $('tf-name').value = v.name;
    $('tf-role-zh').value = v.role.zh || '';
    $('tf-role-en').value = v.role.en || '';
    $('tf-meta-zh').value = v.meta.zh || '';
    $('tf-meta-en').value = v.meta.en || '';
    setImageField('tf-img', v.img);
    $('teamForm').classList.remove('hidden');
    $('teamForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeTeamForm() {
    $('teamForm').classList.add('hidden');
    editingTeamId = null;
}

$('teamAdd').addEventListener('click', () => openTeamForm(null));
$('teamCancel').addEventListener('click', closeTeamForm);
$('teamCancel2').addEventListener('click', closeTeamForm);

$('teamForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!$('tf-img').value) { toast('请为顾问添加头像', true); return; }

    const data = {
        name: $('tf-name').value,
        role: { zh: $('tf-role-zh').value, en: $('tf-role-en').value },
        meta: { zh: $('tf-meta-zh').value, en: $('tf-meta-en').value },
        img: $('tf-img').value
    };

    const editing = editingTeamId;
    const ok = await run(
        () => editing ? api('PUT', `admin/team/${editing}`, data) : api('POST', 'admin/team', data),
        editing ? '顾问信息已更新' : '顾问已新增'
    );
    if (ok) closeTeamForm();
});

$('teamList').addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-delete]');
    if (edit) {
        openTeamForm(content.team.find(t => t.id === Number(edit.dataset.edit)));
    } else if (del) {
        const t = content.team.find(x => x.id === Number(del.dataset.delete));
        if (t && confirm(`确定删除顾问「${t.name}」吗？此操作无法撤销。`)) {
            run(() => api('DELETE', `admin/team/${t.id}`), '顾问已删除');
        }
    }
});

// ---------- who am I + live-database warning ----------
let me = null; // { id, name, owner }

function applyMe(info) {
    me = info.admin;
    $('remoteBanner').classList.toggle('hidden', !info.remoteDb);
    $('adminName').textContent = `${me.name}${me.owner ? ' · 所有者' : ''}`;
    $('meName').textContent = me.name;
    $('meRole').textContent = me.owner ? '所有者' : '管理员';
    $('ownerAdmins').classList.toggle('hidden', !me.owner);
    $('dbLink').classList.toggle('hidden', !me.owner);
}

// ---------- admins ----------
let adminsData = [];
let adminFormMode = null; // 'add' | 'passcode' | 'rename'
let adminFormTarget = null;

const fmtDate = (v) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '从未登录');

async function renderAdmins() {
    if (!me || !me.owner) return;
    adminsData = (await api('GET', 'admin/admins')).admins;
    $('adminCount').textContent = adminsData.length;
    $('adminList').innerHTML = adminsData.map((a) => {
        const self = a.id === me.id;
        const badge = a.owner
            ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gold-100 text-gold-700">所有者</span>'
            : a.active
                ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">正常</span>'
                : '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600">已停用</span>';
        const actions = a.owner
            ? `<button class="btn-ghost !py-1 !px-3" data-act="rename" data-id="${a.id}"><i class="fa-solid fa-pen mr-1"></i>改名</button>`
            : `<button class="btn-ghost !py-1 !px-3" data-act="rename" data-id="${a.id}"><i class="fa-solid fa-pen mr-1"></i>改名</button>
               <button class="btn-ghost !py-1 !px-3" data-act="passcode" data-id="${a.id}"><i class="fa-solid fa-key mr-1"></i>重设密码</button>
               <button class="btn-ghost !py-1 !px-3" data-act="toggle" data-id="${a.id}">${a.active ? '<i class="fa-solid fa-ban mr-1"></i>停用' : '<i class="fa-solid fa-circle-check mr-1"></i>启用'}</button>
               <button class="btn-danger !py-1 !px-3" data-act="delete" data-id="${a.id}"><i class="fa-solid fa-trash mr-1"></i>删除</button>`;
        return `
            <div class="item-card" style="flex-direction:column">
                <div class="flex items-center gap-2 flex-wrap">
                    <h3 class="text-sm font-bold">${esc(a.name)}${self ? ' <span class="text-[11px] text-gray-400 font-normal">（你）</span>' : ''}</h3>
                    ${badge}
                </div>
                <p class="text-[11px] text-gray-400">最近登录：${esc(fmtDate(a.lastLoginAt))}</p>
                <div class="flex flex-wrap gap-2 pt-1">${actions}</div>
            </div>`;
    }).join('');
}

function openAdminForm(mode, target) {
    adminFormMode = mode;
    adminFormTarget = target || null;
    $('adminFormTitle').textContent = mode === 'add' ? '新增管理员' : mode === 'rename' ? `给「${target.name}」改名` : `重设「${target.name}」的密码`;
    $('af-name').value = mode === 'rename' ? target.name : '';
    $('af-pass').value = '';
    $('af-name-wrap').classList.toggle('hidden', mode === 'passcode');
    $('af-pass-wrap').classList.toggle('hidden', mode === 'rename');
    $('af-hint').classList.toggle('hidden', mode === 'rename');
    $('adminForm').classList.remove('hidden');
    $('adminForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    (mode === 'passcode' ? $('af-pass') : $('af-name')).focus();
}

function closeAdminForm() {
    $('adminForm').classList.add('hidden');
    adminFormMode = null;
    adminFormTarget = null;
    $('af-pass').value = '';
}

$('adminAdd').addEventListener('click', () => openAdminForm('add'));
$('adminCancel').addEventListener('click', closeAdminForm);
$('adminCancel2').addEventListener('click', closeAdminForm);

// digits only in every passcode box
document.querySelectorAll('#af-pass, #pc-current, #pc-new, #pc-new2').forEach((el) => {
    el.addEventListener('input', () => { el.value = el.value.replace(/\D/g, '').slice(0, 6); });
});

$('adminForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = adminFormMode;
    const target = adminFormTarget;
    let action, message;
    if (mode === 'add') {
        const body = { name: $('af-name').value, passcode: $('af-pass').value };
        action = () => api('POST', 'admin/admins', body);
        message = '管理员已添加，请把密码告诉对方';
    } else if (mode === 'rename') {
        const body = { name: $('af-name').value };
        action = () => api('PUT', `admin/admins/${target.id}`, body);
        message = '已改名';
    } else {
        const body = { passcode: $('af-pass').value };
        action = () => api('PUT', `admin/admins/${target.id}/passcode`, body);
        message = '密码已重设，请把新密码告诉对方';
    }
    try {
        await action();
        toast(message);
        closeAdminForm();
        await renderAdmins();
    } catch (err) {
        if (!(err instanceof UnauthorizedError)) toast(err.message, true);
    }
});

$('adminList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const target = adminsData.find((a) => a.id === Number(btn.dataset.id));
    if (!target) return;
    const act = btn.dataset.act;
    try {
        if (act === 'rename') openAdminForm('rename', target);
        else if (act === 'passcode') openAdminForm('passcode', target);
        else if (act === 'toggle') {
            const stopping = target.active;
            if (stopping && !confirm(`停用「${target.name}」后，对方会立刻被退出登录，也不能再登录。确定吗？`)) return;
            await api('PUT', `admin/admins/${target.id}`, { active: !target.active });
            toast(stopping ? `已停用「${target.name}」` : `已重新启用「${target.name}」`);
            await renderAdmins();
        } else if (act === 'delete') {
            if (!confirm(`确定删除「${target.name}」吗？此操作无法撤销。`)) return;
            await api('DELETE', `admin/admins/${target.id}`);
            toast('已删除');
            await renderAdmins();
        }
    } catch (err) {
        if (!(err instanceof UnauthorizedError)) toast(err.message, true);
    }
});

$('myPasscodeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('pc-new').value !== $('pc-new2').value) { toast('两次输入的新密码不一致', true); return; }
    try {
        await api('PUT', `admin/admins/${me.id}/passcode`, { currentPasscode: $('pc-current').value, passcode: $('pc-new').value });
        toast('你的密码已修改，下次用新密码登录');
        $('myPasscodeForm').reset();
    } catch (err) {
        if (!(err instanceof UnauthorizedError)) toast(err.message, true);
    }
});

// ---------- load & init ----------
async function refresh() {
    content = await Store.load();
    setImageField('hero-img', content.hero.img);
    banners = (await api('GET', 'admin/hero-banners')).banners;
    renderHeroPanel();
    renderListings();
    renderTeam();
    $('statListings').textContent = content.properties.length;
    $('statTeam').textContent = content.team.length;
    await renderAdmins();
}

function showApiDown(detail) {
    $('apiDownDetail').textContent = detail ? `（${detail}）` : '';
    $('apiDownOverlay').classList.remove('hidden');
}

function revealPanel() {
    document.body.classList.remove('is-booting');
}

async function init() {
    $('apiDownOverlay').classList.add('hidden');
    try { showTab(sessionStorage.getItem('admin-tab') || 'hero'); } catch (e) { showTab('hero'); }
    try {
        applyMe(await api('GET', 'admin/me'));
        await refresh();
        revealPanel();
    } catch (err) {
        if (err instanceof UnauthorizedError) return; // already redirecting to the login page
        revealPanel();
        // Anything else means the backend / database could not be reached: say so instead of showing an empty page
        console.error(err);
        showApiDown(err.message);
    }
}

$('apiDownRetry').addEventListener('click', init);
init();

// If the browser restores this page from its back/forward cache, hide it and re-check the sign-in first
window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
        document.body.classList.add('is-booting');
        init();
    }
});
