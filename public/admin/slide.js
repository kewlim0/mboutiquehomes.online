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
        var played = false;
        var play = function () {
            if (played) return;
            played = true;
            root.classList.remove('slide-hold');
            root.classList.add('is-sliding', cls);
            setTimeout(clear, 600);
        };
        root.classList.add('slide-hold');                     // invisible only until the page structure is there (a moment), then it slides in
        document.addEventListener('DOMContentLoaded', play);
        setTimeout(play, 1200);                               // safety: never leave the page hidden
    }

    // ---- leaving: play the "out" half, then go ----
    window.adminSlide = {
        // handoff=false: the next page is not one of the two slide pages (e.g. /tracker/), so nothing is left for it to play
        go: function (url, direction, handoff) {
            if (calm) { window.location.replace(url); return; }
            if (handoff !== false) { try { sessionStorage.setItem(KEY, direction); } catch (e) { /* ignore */ } }
            root.classList.add('is-sliding', direction === 'forward' ? 'slide-out-left' : 'slide-out-right');
            setTimeout(function () { window.location.replace(url); }, OUT_MS);
        }
    };

    // coming back through the browser's back button (page cache): never show a half-slid page
    window.addEventListener('pageshow', function (e) { if (e.persisted) clear(); });
})();
