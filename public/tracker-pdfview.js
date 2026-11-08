// Full-screen preview of a PDF or a photo, shared by the Tracker pages (Upcoming floor plans, Bill tenancy agreements).
// A page inside the app with an X: the browser's own PDF page has no way back in an installed app.
// pdf.js draws the pages itself (same on iPhone and Android) and is only downloaded when the first PDF is opened.
// A page is drawn while it is near the screen and freed when it is far away. Pinch with two fingers to zoom.
// Use:  trkPdf.open({ url, title, type })   (type: the MIME type; image/* is shown as a photo, anything else as a PDF)
(() => {
'use strict';
const PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let built = false, closedByPop = false, prevOverflow = '';
function build() {
    if (built) return; built = true;
    const st = document.createElement('style'); st.textContent = ".pdfv { position: fixed; inset: 0; z-index: 2000; display: flex; flex-direction: column; background: #0f172a; font-family: inherit; }\n.pdfv.hidden { display: none; }\n.pdfv-bar { display: flex; align-items: center; gap: 0.5rem; padding: max(0.6rem, env(safe-area-inset-top)) 0.7rem 0.6rem; background: #0f172a; color: #fff; }\n.pdfv-bar button { width: 2.4rem; height: 2.4rem; border: 0; border-radius: 0.85rem; display: grid; place-items: center; flex-shrink: 0; background: rgba(255, 255, 255, 0.12); color: #fff; font-size: 0.95rem; font-weight: 800; cursor: pointer; -webkit-tap-highlight-color: transparent; }\n.pdfv-bar button:active { background: rgba(255, 255, 255, 0.24); }\n.pdfv-bar #pdfvZoom { width: auto; min-width: 3.2rem; padding: 0 0.5rem; font-size: 0.72rem; }\n.pdfv-title { flex: 1; min-width: 0; font-size: 0.85rem; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.pdfv-main { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }\n.pdfv-body { flex: 1; min-height: 0; overflow: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; touch-action: pan-x pan-y; background: #334155; padding: 0.5rem 0.5rem max(0.8rem, env(safe-area-inset-bottom)); }\n.pdfv-pages { display: flex; flex-direction: column; align-items: center; width: max-content; min-width: 100%; gap: 0.5rem; }\n.pdfv-page { position: relative; flex-shrink: 0; background: #fff; box-shadow: 0 6px 20px -8px rgba(0, 0, 0, 0.6); }\n.pdfv-page canvas, .pdfv-page img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }\n.pdfv-msg { padding: 3rem 1rem; text-align: center; font-size: 0.85rem; font-weight: 600; line-height: 1.9; color: #e2e8f0; }\n.pdfv-msg a { color: #86efac; font-weight: 800; }\n.pdfv-load { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.8rem; background: #334155; color: #e2e8f0; font-size: 0.78rem; font-weight: 700; }\n.pdfv-load.hidden { display: none; }\n.pdfv-track { width: min(70vw, 18rem); height: 0.5rem; border-radius: 999px; background: rgba(255, 255, 255, 0.16); overflow: hidden; }\n.pdfv-fill { height: 100%; width: 0; border-radius: 999px; background: #22c55e; transition: width 0.15s linear; }\n.pdfv-load.ind .pdfv-fill { width: 38%; transition: none; animation: pdfvInd 1.1s ease-in-out infinite; }\n@keyframes pdfvInd { 0% { transform: translateX(-110%); } 100% { transform: translateX(270%); } }\n"; document.head.appendChild(st);
    document.body.insertAdjacentHTML('beforeend', "<div id=\"pdfv\" class=\"pdfv hidden\" role=\"dialog\" aria-modal=\"true\" aria-label=\"\u9884\u89c8\"><div class=\"pdfv-bar\"><button type=\"button\" id=\"pdfvClose\" aria-label=\"\u5173\u95ed\u9884\u89c8\"><i class=\"fa-solid fa-xmark\"></i></button><div class=\"pdfv-title\" id=\"pdfvTitle\"></div><button type=\"button\" id=\"pdfvOut\" aria-label=\"\u7f29\u5c0f\"><i class=\"fa-solid fa-minus\"></i></button><button type=\"button\" id=\"pdfvZoom\" aria-label=\"\u6062\u590d 100%\">100%</button><button type=\"button\" id=\"pdfvIn\" aria-label=\"\u653e\u5927\"><i class=\"fa-solid fa-plus\"></i></button></div><div class=\"pdfv-main\"><div class=\"pdfv-body\" id=\"pdfvBody\"></div><div class=\"pdfv-load hidden\" id=\"pdfvLoad\"><div class=\"pdfv-track\"><div class=\"pdfv-fill\" id=\"pdfvFill\"></div></div><div id=\"pdfvPct\">0%</div></div></div></div>\n");
    $('pdfvClose').addEventListener('click', () => closePdf(false));
    $('pdfvIn').addEventListener('click', () => pdfZoom(1));
    $('pdfvOut').addEventListener('click', () => pdfZoom(-1));
    $('pdfvZoom').addEventListener('click', () => pdfZoom(0));
    pinch();
}
let pdfJsLoading = null;
function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfJsLoading) pdfJsLoading = new Promise((resolve, reject) => {
        const sc = document.createElement('script'); sc.src = PDFJS_BASE + 'pdf.min.js';
        sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js'; resolve(window.pdfjsLib); };
        sc.onerror = () => { pdfJsLoading = null; reject(new Error('预览工具下载不了，请检查网络')); };
        document.head.appendChild(sc);
    });
    return pdfJsLoading;
}
const ZMIN = 1, ZMAX = 5;
const PV = { doc: null, token: 0, zoom: 1, pages: [], io: null };
function pdfFree(p) {
    if (p.task) { try { p.task.cancel(); } catch (e) { /* already done */ } p.task = null; }
    p.drawn = false; p.stale = false; const c = p.div.firstChild; if (c) { c.width = 0; c.height = 0; c.remove(); }
}
async function pdfDraw(p, token) {
    if (p.img) { if (!p.div.firstChild) p.div.appendChild(p.img.cloneNode()); p.drawn = true; p.stale = false; return; }
    if ((p.drawn && !p.stale) || p.task) return;
    const cssW = p.div.clientWidth || parseFloat(p.div.style.width);
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const area = (cssW * dpr) * (cssW * dpr * p.vp.height / p.vp.width); if (area > 12e6) dpr *= Math.sqrt(12e6 / area);   // phones refuse very big canvases
    const vp = p.page.getViewport({ scale: (cssW / p.vp.width) * dpr });
    const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const task = p.page.render({ canvasContext: c.getContext('2d'), viewport: vp }); p.task = task;
    try { await task.promise; if (token !== PV.token || p.task !== task) return; [...p.div.children].forEach((o) => { o.width = 0; o.height = 0; o.remove(); }); p.div.appendChild(c); p.drawn = true; p.stale = false; }
    catch (e) { /* cancelled: the page went off screen or the preview was closed */ }
    finally { if (p.task === task) p.task = null; }
}
function pdfLayout(keep) {   // keep: {fx, fy, cx, cy} = the spot of the page that must stay under the fingers   // the pages as grey-white boxes of the right size; the picture goes in when a box comes near the screen
    const body = $('pdfvBody'), w = Math.round((body.clientWidth - 16) * PV.zoom), ratio = body.scrollHeight ? body.scrollTop / body.scrollHeight : 0;
    if (PV.io) PV.io.disconnect();
    PV.io = new IntersectionObserver((entries) => entries.forEach((en) => { const p = PV.pages[Number(en.target.dataset.i)]; if (p) en.isIntersecting ? pdfDraw(p, PV.token) : pdfFree(p); }), { root: body, rootMargin: '900px 0px' });
    PV.pages.forEach((p, i) => { p.div.dataset.i = i; p.div.style.width = w + 'px'; p.div.style.height = Math.round(w * p.vp.height / p.vp.width) + 'px'; if (p.task) { try { p.task.cancel(); } catch (e) { /* done */ } p.task = null; } p.stale = true; PV.io.observe(p.div); });   // the old picture stays (stretched) until the sharp one is ready: no blank flash
    if (keep) { body.scrollLeft = keep.fx * body.scrollWidth - keep.cx; body.scrollTop = keep.fy * body.scrollHeight - keep.cy; }
    else { body.scrollTop = ratio * body.scrollHeight; body.scrollLeft = (body.scrollWidth - body.clientWidth) / 2; }
}
function pdfSetZoom(z, keep) {
    z = Math.max(ZMIN, Math.min(ZMAX, Math.round(z * 100) / 100)); if (z === PV.zoom && !keep) return;
    PV.zoom = z; $('pdfvZoom').textContent = Math.round(z * 100) + '%'; if (PV.pages.length) pdfLayout(keep);
}
function pdfZoom(dir) { pdfSetZoom(dir === 0 ? 1 : PV.zoom * (dir > 0 ? 1.5 : 1 / 1.5)); }   // the buttons: dir -1 smaller, +1 bigger, 0 back to 100%
// two fingers: pinch the whole page (live preview with a CSS scale, the sharp redraw happens when the fingers lift)
function pinch() {
    const body = $('pdfvBody'); let g = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t) => { const r = body.getBoundingClientRect(); return { x: (t[0].clientX + t[1].clientX) / 2 - r.left, y: (t[0].clientY + t[1].clientY) / 2 - r.top }; };
    body.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 2 || !PV.pages.length) return;
        const m = mid(e.touches), el = $('pdfvPages'); if (!el) return;
        g = { d0: dist(e.touches), z0: PV.zoom, s: 1, m, fx: (body.scrollLeft + m.x) / body.scrollWidth, fy: (body.scrollTop + m.y) / body.scrollHeight };
        el.style.transformOrigin = `${body.scrollLeft + m.x - 8}px ${body.scrollTop + m.y - 8}px`; el.style.willChange = 'transform';
    }, { passive: true });
    body.addEventListener('touchmove', (e) => {
        if (!g || e.touches.length !== 2) return;
        e.preventDefault();
        g.s = Math.max(ZMIN, Math.min(ZMAX, g.z0 * dist(e.touches) / g.d0)) / g.z0; g.m = mid(e.touches);
        const el = $('pdfvPages'); if (el) el.style.transform = `scale(${g.s})`;
        $('pdfvZoom').textContent = Math.round(g.z0 * g.s * 100) + '%';
    }, { passive: false });
    const end = (e) => {
        if (!g || e.touches.length >= 2) return;
        const k = g; g = null; const el = $('pdfvPages'); if (el) { el.style.transform = ''; el.style.willChange = ''; }
        pdfSetZoom(k.z0 * k.s, { fx: k.fx, fy: k.fy, cx: k.m.x, cy: k.m.y });
    };
    body.addEventListener('touchend', end); body.addEventListener('touchcancel', end);
    document.addEventListener('gesturestart', (e) => { if (!$('pdfv').classList.contains('hidden')) e.preventDefault(); });   // iOS Safari: no page zoom behind the preview
}

// the progress bar in the middle of the screen (indeterminate until the size of the file is known)
function setProgress(frac) {
    const box = $('pdfvLoad'); box.classList.remove('hidden');
    if (frac == null) { box.classList.add('ind'); $('pdfvPct').textContent = '加载中…'; return; }
    box.classList.remove('ind'); const p = Math.max(0, Math.min(100, Math.round(frac * 100)));
    $('pdfvFill').style.width = p + '%'; $('pdfvPct').textContent = p + '%';
}
function hideProgress() { $('pdfvLoad').classList.add('hidden'); }
async function download(url, my, onFrac) {   // the file as bytes, reporting how much has arrived
    const res = await fetch(url, { credentials: 'same-origin' });
    if (res.status === 401) { const e = new Error('401'); e.status = 401; throw e; }
    if (!res.ok) throw new Error('文件打不开（' + res.status + '）');
    const total = Number(res.headers.get('content-length')) || 0, type = res.headers.get('content-type') || '';
    if (!res.body || !res.body.getReader) { const buf = new Uint8Array(await res.arrayBuffer()); onFrac(1); return { bytes: buf, type }; }
    const rd = res.body.getReader(), parts = []; let got = 0;
    for (;;) {
        const { done, value } = await rd.read(); if (my !== PV.token) { try { rd.cancel(); } catch (e) { /* closed */ } return null; }
        if (done) break; parts.push(value); got += value.length; onFrac(total ? got / total : null);
    }
    const bytes = new Uint8Array(got); let o = 0; for (const c of parts) { bytes.set(c, o); o += c.length; }
    return { bytes, type };
}
async function openPdf(opts) {
    build();
    const my = ++PV.token; PV.zoom = 1; $('pdfvZoom').textContent = '100%'; $('pdfvTitle').textContent = opts.title || '';
    const body = $('pdfvBody'); body.innerHTML = ''; body.scrollTop = 0; body.scrollLeft = 0; setProgress(null);
    if ($('pdfv').classList.contains('hidden')) prevOverflow = document.body.style.overflow;
    $('pdfv').classList.remove('hidden'); document.body.style.overflow = 'hidden';
    if (!(history.state && history.state.pdfv)) history.pushState(Object.assign({}, history.state, { pdfv: 1 }), '');   // the phone's back swipe / button closes the preview instead of leaving the page
    try {
        const wantImage = /^image\//.test(opts.type || '');
        const [lib, file] = await Promise.all([wantImage ? null : loadPdfJs(), download(opts.url, my, setProgress)]);
        if (my !== PV.token || !file) return;
        const isImage = wantImage || /^image\//.test(file.type);
        PV.pages = []; body.innerHTML = '<div class="pdfv-pages" id="pdfvPages"></div>'; const wrap = $('pdfvPages');
        if (isImage) {
            const blobUrl = URL.createObjectURL(new Blob([file.bytes], { type: file.type || opts.type || 'image/jpeg' }));
            const img = new Image(); img.alt = ''; img.src = blobUrl; await img.decode();
            if (my !== PV.token) { URL.revokeObjectURL(blobUrl); return; }
            const div = document.createElement('div'); div.className = 'pdfv-page'; wrap.appendChild(div);
            PV.pages.push({ img, blobUrl, div, vp: { width: img.naturalWidth, height: img.naturalHeight }, task: null, drawn: false });
        } else {
            const pl = lib || await loadPdfJs();
            const doc = await pl.getDocument({ data: file.bytes }).promise;
            if (my !== PV.token) { doc.destroy(); return; }          // closed (or another one opened) while it was loading
            PV.doc = doc;
            for (let i = 1; i <= doc.numPages; i++) {
                const page = await doc.getPage(i); if (my !== PV.token) return;
                const div = document.createElement('div'); div.className = 'pdfv-page'; wrap.appendChild(div);
                PV.pages.push({ page, div, vp: page.getViewport({ scale: 1 }), task: null, drawn: false });
            }
        }
        hideProgress(); pdfLayout();
    } catch (e) {
        if (my !== PV.token) return;
        hideProgress();
        if (e && e.status === 401) { location.replace('/admin/?next=' + encodeURIComponent(location.pathname)); return; }
        const msg = e && /[\u4e00-\u9fa5]/.test(e.message) ? e.message : '打不开这个文件，文件可能已损坏';
        body.innerHTML = `<p class="pdfv-msg">${esc(msg)}<br><a href="${esc(opts.url)}" target="_blank" rel="noopener">改用浏览器打开</a></p>`;
    }
}
function closePdf(fromPopstate) {
    if (!built || $('pdfv').classList.contains('hidden')) return;
    PV.token++; if (PV.io) { PV.io.disconnect(); PV.io = null; }
    PV.pages.forEach((p) => { pdfFree(p); if (p.blobUrl) URL.revokeObjectURL(p.blobUrl); }); PV.pages = []; if (PV.doc) { PV.doc.destroy(); PV.doc = null; }
    $('pdfv').classList.add('hidden'); $('pdfvBody').innerHTML = ''; hideProgress();
    document.body.style.overflow = prevOverflow;
    if (!fromPopstate && history.state && history.state.pdfv) history.back();
}
window.addEventListener('popstate', () => { closedByPop = built && !$('pdfv').classList.contains('hidden'); closePdf(true); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && built && !$('pdfv').classList.contains('hidden')) { e.stopPropagation(); closePdf(false); } }, true);
window.trkPdf = { open: openPdf, close: () => closePdf(false), isOpen: () => built && !$('pdfv').classList.contains('hidden'), consumePop: () => { const v = closedByPop; closedByPop = false; return v; } };
})();
