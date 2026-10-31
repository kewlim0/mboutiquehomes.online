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

    // ---- arriving: play the "in" half ----
    var dir = null;
    try {
        var raw = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY);
        var f = raw && JSON.parse(raw);
        if (f && Date.now() - f.t < 4000 && (f.dir === 'fwd' || f.dir === 'back')) dir = f.dir;
    } catch (e) { /* storage blocked: no animation */ }
    if (!reduce && dir) {
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
    window.addEventListener('pageshow', function (e) { if (e.persisted) { clear(); unspin(); } });

    // depth: /tracker/ = 0, /tracker/sim/ (and bill, tenants) = 1
    function depth(path) { var p = path.replace(/\/+$/, '').split('/').filter(Boolean); return p[0] === 'tracker' ? p.length - 1 : -1; }

    document.addEventListener('click', function (e) {
        if (reduce || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
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
        var icon = a.querySelector('.go i, i.fa-chevron-left');
        if (icon) { spun = { icon: icon, cls: icon.className }; icon.className = 'fa-solid fa-circle-notch fa-spin'; }
        try { sessionStorage.setItem(KEY, JSON.stringify({ dir: direction, t: Date.now() })); } catch (err) { /* ignore */ }
        root.classList.add('trk-anim', 'trk-out-' + direction);
        setTimeout(function () { location.href = url.href; }, OUT_MS);
    });
})();
