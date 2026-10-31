// Slide transition between the /tracker/ pages.
//  - going deeper (overview -> SIM / Bill / Tenants): the old page slides off to the left, the new one comes in from the right
//  - going back (a page -> overview): the old page slides off to the right, the new one comes in from the left
// Load it in <head> so the "coming in" animation starts before the first paint. Only links between /tracker/ pages are animated;
// the browser's own back button / iPhone swipe-back is left alone (it has its own animation).
(function () {
    var KEY = 'trk_slide';
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var root = document.documentElement;

    var css = document.createElement('style');
    css.textContent =
        '@keyframes trk-in-fwd { from { transform: translateX(100%); } to { transform: none; } }' +
        '@keyframes trk-in-back { from { transform: translateX(-100%); } to { transform: none; } }' +
        '@keyframes trk-out-fwd { from { transform: none; opacity: 1; } to { transform: translateX(-28%); opacity: 0.35; } }' +
        '@keyframes trk-out-back { from { transform: none; opacity: 1; } to { transform: translateX(28%); opacity: 0.35; } }' +
        'html.trk-anim { overflow-x: hidden; }' +
        'html.trk-in-fwd > body { animation: trk-in-fwd 0.34s cubic-bezier(0.22, 1, 0.36, 1) both; }' +
        'html.trk-in-back > body { animation: trk-in-back 0.34s cubic-bezier(0.22, 1, 0.36, 1) both; }' +
        'html.trk-out-fwd > body { animation: trk-out-fwd 0.2s ease-in both; }' +
        'html.trk-out-back > body { animation: trk-out-back 0.2s ease-in both; }';
    document.head.appendChild(css);

    function clear() { root.classList.remove('trk-anim', 'trk-in-fwd', 'trk-in-back', 'trk-out-fwd', 'trk-out-back'); }

    // arriving: was the last click an animated one (and recent)?
    try {
        var raw = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY);
        var f = raw && JSON.parse(raw);
        if (f && !reduce && Date.now() - f.t < 4000 && (f.dir === 'fwd' || f.dir === 'back')) {
            root.classList.add('trk-anim', 'trk-in-' + f.dir);
            setTimeout(clear, 450);
        }
    } catch (e) { /* storage blocked: no animation */ }

    // coming back from the browser's back/forward cache: never show a half-finished slide
    window.addEventListener('pageshow', function (e) { if (e.persisted) clear(); });

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
        var dir = to > from ? 'fwd' : 'back';
        try { sessionStorage.setItem(KEY, JSON.stringify({ dir: dir, t: Date.now() })); } catch (err) { /* ignore */ }
        root.classList.add('trk-anim', 'trk-out-' + dir);
        setTimeout(function () { location.href = url.href; }, 190);
    });
})();
