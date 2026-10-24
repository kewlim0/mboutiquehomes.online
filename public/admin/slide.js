// Page slide between the login page and the dashboard:
//   signing in  -> the login page slides out to the left and the dashboard slides in from the right
//   signing out -> the dashboard slides out to the right and the login page slides in from the left
// The two are separate pages, so the direction is handed over in sessionStorage and the next page plays the "in" half.
// Load this in the <head> so the incoming page never flashes before it slides.
(function () {
    var KEY = 'admin-slide';
    var root = document.documentElement;
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var OUT_MS = 240;

    function clear() {
        root.classList.remove('is-sliding', 'slide-hold', 'slide-in-right', 'slide-in-left', 'slide-out-left', 'slide-out-right');
    }

    // ---- arriving: play the "in" half ----
    var dir = null;
    try { dir = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); } catch (e) { /* storage blocked: no animation */ }
    if (!calm && (dir === 'forward' || dir === 'back')) {
        var cls = dir === 'forward' ? 'slide-in-right' : 'slide-in-left';
        var play = function () {
            root.classList.remove('slide-hold');
            root.classList.add('is-sliding', cls);
            setTimeout(clear, 600);
        };
        root.classList.add('slide-hold');                     // keep the page invisible until it is ready to slide
        if (root.hasAttribute('data-slide-wait')) {
            // the dashboard hides itself until its first data has loaded (is-booting): slide in when that is over
            document.addEventListener('DOMContentLoaded', function () {
                var body = document.body;
                if (!body.classList.contains('is-booting')) { play(); return; }
                var done = false;
                var go = function () { if (!done) { done = true; obs.disconnect(); play(); } };
                var obs = new MutationObserver(function () { if (!body.classList.contains('is-booting')) go(); });
                obs.observe(body, { attributes: true, attributeFilter: ['class'] });
                setTimeout(go, 2500);                          // never wait longer than this
            });
        } else {
            document.addEventListener('DOMContentLoaded', play);
        }
    }

    // ---- leaving: play the "out" half, then go ----
    window.adminSlide = {
        go: function (url, direction) {
            if (calm) { window.location.replace(url); return; }
            try { sessionStorage.setItem(KEY, direction); } catch (e) { /* ignore */ }
            root.classList.add('is-sliding', direction === 'forward' ? 'slide-out-left' : 'slide-out-right');
            setTimeout(function () { window.location.replace(url); }, OUT_MS);
        }
    };

    // coming back through the browser's back button (page cache): never show a half-slid page
    window.addEventListener('pageshow', function (e) { if (e.persisted) clear(); });
})();
