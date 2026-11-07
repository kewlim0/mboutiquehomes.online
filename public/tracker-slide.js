// Page slide between the /tracker/ pages, the same way the admin login <-> dashboard slide works (public/admin/slide.js):
//   going deeper (overview -> SIM / Bill / Tenants): the old page slides out to the left and fades away, the new page slides in from the right
//   going back (a page -> overview): the old page slides out to the right, the new page slides in from the left
// The pages are separate documents, so the direction is handed over in sessionStorage and the next page plays the "in" half.
// The tapped button turns into a spinner straight away. Load this in <head> so the incoming page is never seen before it slides.
// Only links between /tracker/ pages are animated; the browser's own back button / iPhone swipe-back keeps its own animation.
(function () {
    var KEY = 'trk_slide';
    var OUT_MS = 240;
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var root = document.documentElement;

    var css = document.createElement('style');
    css.textContent =
        '@keyframes trk-in-fwd { from { transform: translate3d(100%, 0, 0); opacity: 0.4; } to { transform: translate3d(0, 0, 0); opacity: 1; } }' +
        '@keyframes trk-in-back { from { transform: translate3d(-35%, 0, 0); opacity: 0; } to { transform: translate3d(0, 0, 0); opacity: 1; } }' +
        '@keyframes trk-out-fwd { from { transform: translate3d(0, 0, 0); opacity: 1; } to { transform: translate3d(-35%, 0, 0); opacity: 0; } }' +
        '@keyframes trk-out-back { from { transform: translate3d(0, 0, 0); opacity: 1; } to { transform: translate3d(100%, 0, 0); opacity: 0.4; } }' +
        'html.trk-anim { overflow-x: hidden; }' +
        // invisible only until the page structure is there (a moment), then it slides in
        'html.trk-hold > body { opacity: 0; }' +
        'html.trk-in-fwd > body { animation: trk-in-fwd 0.42s cubic-bezier(0.22, 1, 0.36, 1) both; will-change: transform, opacity; }' +
        'html.trk-in-back > body { animation: trk-in-back 0.42s cubic-bezier(0.22, 1, 0.36, 1) both; will-change: transform, opacity; }' +
        'html.trk-out-fwd > body { animation: trk-out-fwd 0.24s ease-in both; will-change: transform, opacity; }' +
        'html.trk-out-back > body { animation: trk-out-back 0.24s ease-in both; will-change: transform, opacity; }' +
        // blur effects are expensive to move around: off while sliding
        'html.trk-anim *, html.trk-anim *::before, html.trk-anim *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }';
    document.head.appendChild(css);

    function clear() { root.classList.remove('trk-anim', 'trk-hold', 'trk-in-fwd', 'trk-in-back', 'trk-out-fwd', 'trk-out-back'); }

    // ---- "保存中…" overlay (shared by the Save buttons of the tracker pages) ----
    //   trkSaving.run(async () => { ...save... })  shows the box with a turning spinner while the work runs, and always hides it again.
    //   The box stays at least 450 ms, so a very fast save does not just flash.
    var hud = null;
    function hudEl() {
        if (hud) return hud;
        var bars = '';
        for (var i = 0; i < 12; i++) bars += '<rect x="22" y="3" width="4" height="11" rx="2" fill="#1e293b" opacity="' + (1 - i * 0.075).toFixed(3) + '" transform="rotate(' + (-i * 30) + ' 24 24)"/>';
        var st = document.createElement('style');
        st.textContent =
            '.trk-hud { position: fixed; inset: 0; z-index: 120; display: none; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.38); -webkit-tap-highlight-color: transparent; }' +
            '.trk-hud.on { display: flex; animation: trk-hud-fade 0.18s ease-out both; }' +
            '.trk-hud.still, .trk-hud.still .trk-hud-box { animation: none; }' +
            '@keyframes trk-hud-fade { from { opacity: 0; } to { opacity: 1; } }' +
            '.trk-hud-box { min-width: 150px; padding: 22px 26px 18px; border-radius: 22px; background: #fff; text-align: center; box-shadow: 0 30px 60px -18px rgba(15, 23, 42, 0.55); animation: trk-hud-pop 0.2s cubic-bezier(0.22, 1, 0.36, 1) both; }' +
            '@keyframes trk-hud-pop { from { transform: scale(0.9); opacity: 0; } to { transform: none; opacity: 1; } }' +
            '.trk-hud-spin { width: 48px; height: 48px; display: block; margin: 0 auto; animation: trk-hud-turn 0.9s linear infinite; will-change: transform; }' +
            '@keyframes trk-hud-turn { to { transform: rotate(360deg); } }' +
            '.trk-hud-text { margin-top: 12px; font: 700 14px/1.2 Inter, "PingFang SC", "Noto Sans SC", system-ui, sans-serif; color: #334155; letter-spacing: 0.02em; }' +
            '@media (prefers-reduced-motion: reduce) { .trk-hud-spin { animation-duration: 2.4s; } }';
        document.head.appendChild(st);
        hud = document.createElement('div');
        hud.className = 'trk-hud'; hud.setAttribute('role', 'alertdialog'); hud.setAttribute('aria-live', 'assertive'); hud.setAttribute('aria-label', '保存中');
        hud.innerHTML = '<div class="trk-hud-box"><svg class="trk-hud-spin" viewBox="0 0 48 48" aria-hidden="true">' + bars + '</svg><div class="trk-hud-text">保存中…</div></div>';
        root.appendChild(hud);
        return hud;
    }
    window.trkSaving = {
        show: function (text, still) { var el = hudEl(); el.querySelector('.trk-hud-text').textContent = text || '保存中…'; el.classList.toggle('still', !!still); el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); },
        hide: function () { if (hud) hud.classList.remove('on'); },
        run: function (work, text) {
            var el = hudEl(); el.querySelector('.trk-hud-text').textContent = text || '保存中…';
            el.classList.add('on');
            var t0 = Date.now();
            var finish = function () { var wait = Math.max(0, 450 - (Date.now() - t0)); return new Promise(function (r) { setTimeout(function () { el.classList.remove('on'); r(); }, wait); }); };
            return Promise.resolve().then(work).then(
                function (v) { return finish().then(function () { return v; }); },
                function (err) { el.classList.remove('on'); throw err; }   // an error: hide the box at once so the message is seen
            );
        }
    };

    // ---- arriving: play the "in" half ----
    var dir = null;
    try {
        var raw = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY);
        var f = raw && JSON.parse(raw);
        if (f && Date.now() - f.t < 4000 && (f.dir === 'fwd' || f.dir === 'back')) dir = f.dir;
    } catch (e) { /* storage blocked: no animation */ }
    if (dir) {
        // going deeper or back: the "加载中…" box (already shown by the page we came from) stays until the first skeleton shimmer is on screen
        var shown = false;
        var done = function () { if (shown) return; shown = true; if (mo) mo.disconnect(); window.trkSaving.hide(); };
        var look = function () { if (document.querySelector('.sk')) done(); };
        var mo = window.MutationObserver ? new MutationObserver(look) : null;
        window.trkSaving.show('加载中…', true);
        if (mo) mo.observe(root, { childList: true, subtree: true });
        document.addEventListener('DOMContentLoaded', look);
        window.addEventListener('load', function () { setTimeout(done, 300); });   // no skeleton on this page: hide once loaded
        setTimeout(done, 8000);                                                  // safety: never leave it stuck
    } else if (!reduce && dir) {
        var played = false;
        var play = function () {
            if (played) return;
            played = true;
            root.classList.remove('trk-hold');
            root.classList.add('trk-anim', 'trk-in-' + dir);
            setTimeout(clear, 650);
        };
        root.classList.add('trk-anim', 'trk-hold');
        document.addEventListener('DOMContentLoaded', play);
        setTimeout(play, 1200);                                // safety: never leave the page hidden
    }

    // ---- leaving: the tapped button spins, the page plays the "out" half, then we go ----
    var spun = null, busy = false;       // spun = { icon, cls } of the button that shows a spinner
    function unspin() { if (spun) { spun.icon.className = spun.cls; spun = null; } busy = false; }

    // coming back through the browser's back button (page cache): never show a half-slid page or a stuck spinner
    window.addEventListener('pageshow', function (e) { if (e.persisted) { clear(); unspin(); window.trkSaving.hide(); } });

    // depth: /tracker/ = 0, /tracker/sim/ (and bill, tenants) = 1
    function depth(path) { var p = path.replace(/\/+$/, '').split('/').filter(Boolean); return p[0] === 'tracker' ? p.length - 1 : -1; }

    document.addEventListener('click', function (e) {
        if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var a = e.target.closest && e.target.closest('a[href]');
        if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
        var url; try { url = new URL(a.href, location.href); } catch (err) { return; }
        if (url.origin !== location.origin) return;
        var from = depth(location.pathname), to = depth(url.pathname);
        if (from < 0 || to < 0 || from === to) return;           // only between tracker pages of different depth
        e.preventDefault();
        if (busy) return;                                         // a second tap while leaving does nothing
        busy = true;
        var direction = to > from ? 'fwd' : 'back';
        try { sessionStorage.setItem(KEY, JSON.stringify({ dir: direction, t: Date.now() })); } catch (err) { /* ignore */ }
        window.trkSaving.show('加载中…');
        setTimeout(function () { location.href = url.href; }, 120);
    });
})();

// ---- the Tracker as an installed app ----
// service worker: makes it installable and shows a page when offline (it stores nothing private, see /tracker-sw.js)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/tracker-sw.js', { scope: '/tracker/' }).catch(function () { /* the site works without it */ }); });
}
// Chrome (Android / desktop) offers "install" once through this event: keep it for the install button on the overview page
window.trkInstall = { prompt: null, onChange: null, installed: false };
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); window.trkInstall.prompt = e; if (window.trkInstall.onChange) window.trkInstall.onChange(); });
window.addEventListener('appinstalled', function () { window.trkInstall.prompt = null; window.trkInstall.installed = true; if (window.trkInstall.onChange) window.trkInstall.onChange(); });
// app feel: no pull-to-refresh bounce, no grey flash on taps, no long-press menu on buttons and icons
(function () {
    var st = document.createElement('style');
    st.textContent = 'html,body{overscroll-behavior-y:contain;-webkit-tap-highlight-color:transparent}button,a,.tile,.btn{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}input,textarea,select,td{-webkit-user-select:text;user-select:text}';
    document.head.appendChild(st);
})();
