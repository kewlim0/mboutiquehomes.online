// Slide transition between the /tracker/ pages.
//  1. you tap a button: it turns into a spinner and the current page stays exactly as it is
//  2. the next page is loaded in a hidden frame in the background, until it has drawn itself (styles, first screen)
//  3. only then the slide happens:
//       going deeper (overview -> SIM / Bill / Tenants): the old page slides off to the left, the new one comes in from the right
//       going back (a page -> overview): the old page slides off to the right, the new one comes in from the left
// Load it in <head> so the "coming in" animation starts before the first paint. Only links between /tracker/ pages are animated;
// the browser's own back button / iPhone swipe-back is left alone (it has its own animation).
(function () {
    var KEY = 'trk_slide';
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var root = document.documentElement;

    var css = document.createElement('style');
    css.textContent =
        '@keyframes trk-in-fwd { from { transform: translate3d(100%, 0, 0); } to { transform: translate3d(0, 0, 0); } }' +
        '@keyframes trk-in-back { from { transform: translate3d(-100%, 0, 0); } to { transform: translate3d(0, 0, 0); } }' +
        '@keyframes trk-out-fwd { from { transform: translate3d(0, 0, 0); opacity: 1; } to { transform: translate3d(-28%, 0, 0); opacity: 0.35; } }' +
        '@keyframes trk-out-back { from { transform: translate3d(0, 0, 0); opacity: 1; } to { transform: translate3d(28%, 0, 0); opacity: 0.35; } }' +
        'html.trk-anim { overflow-x: hidden; }' +
        // the page waits off screen until it is ready (see below); the slide itself runs on the GPU
        'html.trk-anim > body { will-change: transform; }' +
        'html.trk-pre-fwd > body { transform: translate3d(100%, 0, 0); }' +
        'html.trk-pre-back > body { transform: translate3d(-100%, 0, 0); }' +
        // blur effects are expensive to move around: switch them off for the half second of the slide
        'html.trk-anim *, html.trk-anim *::before, html.trk-anim *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }' +
        'html.trk-in-fwd > body { animation: trk-in-fwd 0.34s cubic-bezier(0.22, 1, 0.36, 1) both; }' +
        'html.trk-in-back > body { animation: trk-in-back 0.34s cubic-bezier(0.22, 1, 0.36, 1) both; }' +
        'html.trk-out-fwd > body { animation: trk-out-fwd 0.2s ease-in both; }' +
        'html.trk-out-back > body { animation: trk-out-back 0.2s ease-in both; }';
    document.head.appendChild(css);

    function clear() { root.classList.remove('trk-anim', 'trk-pre-fwd', 'trk-pre-back', 'trk-in-fwd', 'trk-in-back', 'trk-out-fwd', 'trk-out-back'); }

    // This copy of the page is the hidden preview frame: tell the parent when it has drawn itself, and do nothing else.
    var isPreview = window.parent !== window && /[?&]trkpreview=1(&|$)/.test(location.search);
    if (isPreview) {
        var told = false; // (the page is also given a little time after DOMContentLoaded for the style builder to finish)
        var tell = function () { if (told) return; told = true; try { parent.postMessage({ trkReady: true }, location.origin); } catch (e) { /* ignore */ } };
        document.addEventListener('DOMContentLoaded', function () {
            // let the style builder and the first render finish before saying so
            setTimeout(function () {
                requestAnimationFrame(function () { requestAnimationFrame(tell); });
                setTimeout(tell, 250);   // some browsers hold back frames for a hidden frame: do not depend on them
            }, 80);
        });
        return;
    }

    // arriving: was the last click an animated one (and recent)?
    try {
        var raw = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY);
        var f = raw && JSON.parse(raw);
        if (f && !reduce && Date.now() - f.t < 4000 && (f.dir === 'fwd' || f.dir === 'back')) {
            // Do not start sliding while the page is still building itself (styles, first render): that is what made it stutter.
            // Park it off screen, and slide it in once the document is ready and has had a moment to lay out.
            var dir = f.dir, started = false;
            root.classList.add('trk-anim', 'trk-pre-' + dir);
            var play = function () {
                if (started) return; started = true;
                requestAnimationFrame(function () {
                    root.classList.remove('trk-pre-' + dir);
                    root.classList.add('trk-in-' + dir);
                    setTimeout(clear, 450);
                });
            };
            document.addEventListener('DOMContentLoaded', function () { setTimeout(play, 70); });
            setTimeout(play, 1500);   // never leave the page parked if something is slow
        }
    } catch (e) { /* storage blocked: no animation */ }

    // coming back from the browser's back/forward cache: never show a half-finished slide
    var spun = null;   // { icon, cls } of the button that is showing a spinner
    function unspin() { if (spun) { spun.icon.className = spun.cls; spun = null; } busy = false; }
    var busy = false;
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
        if (busy) return;                                         // a second tap while loading does nothing
        busy = true;
        var dir = to > from ? 'fwd' : 'back';

        // 1. the tapped button becomes a spinner
        var icon = a.querySelector('.go i, i.fa-chevron-left');
        if (icon) { spun = { icon: icon, cls: icon.className }; icon.className = 'fa-solid fa-circle-notch fa-spin'; }

        // 2. load the next page in a hidden frame; 3. when it says it is ready, slide
        var started = Date.now(), done = false, frame = document.createElement('iframe');
        var go = function () {
            if (done) return; done = true;
            window.removeEventListener('message', onMsg);
            if (frame.parentNode) frame.parentNode.removeChild(frame);
            try { sessionStorage.setItem(KEY, JSON.stringify({ dir: dir, t: Date.now() })); } catch (err) { /* ignore */ }
            root.classList.add('trk-anim', 'trk-out-' + dir);
            setTimeout(function () { location.href = url.href; }, 190);
        };
        var onMsg = function (m) {
            if (m.source !== frame.contentWindow || !m.data || !m.data.trkReady) return;
            // keep the spinner on screen long enough to be seen
            setTimeout(go, Math.max(0, 260 - (Date.now() - started)));
        };
        window.addEventListener('message', onMsg);
        frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
        frame.style.cssText = 'position:fixed;left:-200vw;top:0;width:100vw;height:100vh;border:0;opacity:0;pointer-events:none';
        frame.src = url.pathname + (url.search ? url.search + '&' : '?') + 'trkpreview=1';
        document.body.appendChild(frame);
        setTimeout(go, 4500);                                    // never leave the button spinning if the preview never answers
    });
})();
