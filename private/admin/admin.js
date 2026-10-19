// Admin page: edits the site content (hero image, listings, team) through the Express/MySQL API.

const $ = (id) => document.getElementById(id);
const API = Store.ROOT + 'api/';
let content = { hero: { img: '' }, properties: [], team: [] };

const AREA_LABELS = {
    'KLCC': { zh: 'KLCC 核心区', en: 'KLCC Core' },
    'Mont Kiara': { zh: 'Mont Kiara', en: 'Mont Kiara' },
    'TRX': { zh: 'TRX', en: 'TRX' },
    'Bangsar': { zh: 'Bangsar', en: 'Bangsar' }
};

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
            <div class="img-preview ${previewClass}"><img id="${id}-preview" alt="预览"></div>
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
    try { sessionStorage.setItem('admin-tab', name); } catch (e) { /* ignore */ }
}

document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---------- hero ----------
$('heroField').innerHTML = imageFieldHtml('hero-img', '横幅照片', 'aspect-[16/9] w-full max-w-xl');
bindImageField('hero-img', 1400);

$('heroSave').addEventListener('click', () => {
    const img = $('hero-img').value;
    if (!img) { toast('请先选择一张横幅照片', true); return; }
    run(() => api('PUT', 'admin/hero', { img }), '首页横幅已更新');
});

$('heroReset').addEventListener('click', () => {
    run(() => api('PUT', 'admin/hero', { img: 'img/banner-main.jpeg' }), '已恢复默认横幅');
});

// ---------- listings ----------
let editingListingId = null;
$('lf-img-wrap').innerHTML = imageFieldHtml('lf-img', '房源照片', 'aspect-[16/10] w-full max-w-sm');
bindImageField('lf-img', 1000);

function formatPrice(p) {
    return p.type === 'rent' ? `RM ${Number(p.priceRM).toLocaleString()} / 月` : `RM ${(p.priceRM / 10000).toFixed(0)} 万`;
}

function renderListings() {
    $('listingCount').textContent = content.properties.length;
    $('listingList').innerHTML = content.properties.length === 0
        ? '<p class="text-sm text-gray-400 sm:col-span-2 py-8 text-center">还没有房源，点击右上角「新增房源」。</p>'
        : content.properties.map(p => `
            <div class="item-card">
                <img src="${esc(Store.resolve(p.img))}" alt="" onerror="this.removeAttribute('src')">
                <div class="min-w-0 flex-1 flex flex-col">
                    <div class="flex items-center gap-2 mb-0.5">
                        <span class="text-[10px] font-bold px-1.5 py-0.5 rounded text-white ${p.type === 'rent' ? 'bg-gold-500' : 'bg-charcoal-900'}">${p.type === 'rent' ? '出租' : '出售'}</span>
                        <span class="text-[11px] text-gray-400 truncate">${esc(p.location.zh)}</span>
                    </div>
                    <h3 class="text-sm font-bold leading-snug line-clamp-2">${esc(p.title.zh)}</h3>
                    <p class="text-xs font-bold text-gold-700 mt-0.5">${formatPrice(p)}</p>
                    <div class="mt-auto pt-2 flex gap-2">
                        <button class="btn-ghost !py-1 !px-3" data-edit="${p.id}"><i class="fa-solid fa-pen mr-1"></i>编辑</button>
                        <button class="btn-danger !py-1 !px-3" data-delete="${p.id}"><i class="fa-solid fa-trash mr-1"></i>删除</button>
                    </div>
                </div>
            </div>`).join('');
}

function openListingForm(p) {
    editingListingId = p ? p.id : null;
    $('listingFormTitle').textContent = p ? '编辑房源' : '新增房源';
    const v = p || {
        title: {}, type: 'rent', priceRM: '', areaSqft: '', area: 'KLCC', beds: {},
        location: AREA_LABELS['KLCC'], address: '', status: {}, desc: {}, img: ''
    };
    $('lf-title-zh').value = v.title.zh || '';
    $('lf-title-en').value = v.title.en || '';
    $('lf-type').value = v.type;
    $('lf-price').value = v.priceRM;
    $('lf-sqft').value = v.areaSqft;
    $('lf-area').value = v.area;
    $('lf-bed-zh').value = v.beds.zh || '';
    $('lf-bed-en').value = v.beds.en || '';
    $('lf-loc-zh').value = v.location.zh || '';
    $('lf-loc-en').value = v.location.en || '';
    $('lf-address').value = v.address || '';
    $('lf-status-zh').value = v.status.zh || '';
    $('lf-status-en').value = v.status.en || '';
    $('lf-desc-zh').value = v.desc.zh || '';
    $('lf-desc-en').value = v.desc.en || '';
    setImageField('lf-img', v.img);
    $('listingForm').classList.remove('hidden');
    $('listingForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeListingForm() {
    $('listingForm').classList.add('hidden');
    editingListingId = null;
}

$('listingAdd').addEventListener('click', () => openListingForm(null));
$('listingCancel').addEventListener('click', closeListingForm);
$('listingCancel2').addEventListener('click', closeListingForm);

// Changing the area fills in that area's default display name
$('lf-area').addEventListener('change', (e) => {
    const label = AREA_LABELS[e.target.value];
    $('lf-loc-zh').value = label.zh;
    $('lf-loc-en').value = label.en;
});

$('listingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!$('lf-img').value) { toast('请为房源添加一张照片', true); return; }

    const area = $('lf-area').value;
    const data = {
        title: { zh: $('lf-title-zh').value, en: $('lf-title-en').value },
        type: $('lf-type').value,
        priceRM: Number($('lf-price').value),
        areaSqft: Number($('lf-sqft').value),
        beds: { zh: $('lf-bed-zh').value, en: $('lf-bed-en').value },
        area,
        location: {
            zh: $('lf-loc-zh').value.trim() || AREA_LABELS[area].zh,
            en: $('lf-loc-en').value.trim() || AREA_LABELS[area].en
        },
        address: $('lf-address').value,
        img: $('lf-img').value,
        status: { zh: $('lf-status-zh').value, en: $('lf-status-en').value },
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
                    <div class="mt-auto pt-2 flex gap-2">
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
