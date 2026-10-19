// Shared content client. Content (hero image, listings, team) lives in MySQL behind the Express API;
// this file only fetches it and resolves image paths.
const Store = (() => {
    // Folder that contains store.js (the site root), so relative paths like "img/..." and "uploads/..."
    // work from any page (home, /listings, /admin)
    const ROOT = new URL('.', document.currentScript.src).href;

    // Fetch everything the public pages need: { hero, properties, team }
    async function load() {
        const res = await fetch(ROOT + 'api/content', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load content (' + res.status + ')');
        return res.json();
    }

    // Turn a stored image path into a usable URL (absolute URLs are left alone)
    function resolve(url) {
        return /^(https?:|\/\/)/.test(url || '') ? url : ROOT + (url || '');
    }

    // ---------- scheduled hero banners (everything is calculated in GMT+8, whatever the visitor's own time zone) ----------
    // Day = 07:00-18:59, night = 19:00-06:59.
    const TZ_MS = 8 * 3600 * 1000;
    const DAY_START = 7;
    const NIGHT_START = 19;

    // Wall-clock parts in GMT+8: { ymd: 'YYYY-MM-DD', hour, minute }
    function gmt8(when = new Date()) {
        const t = new Date(when.getTime() + TZ_MS);
        return { ymd: t.toISOString().slice(0, 10), hour: t.getUTCHours(), minute: t.getUTCMinutes() };
    }

    const phaseOf = (hour) => (hour >= DAY_START && hour < NIGHT_START ? 'day' : 'night');

    // Which banner is shown at `when` (or at an explicit { ymd, phase }, used by the admin preview)?
    // The most specific banner wins: date range + day/night > date range > day/night only > every day, all day.
    // Nothing matches -> the default banner (hero.img).
    // Returns { img, banner (or null), phase, ymd, reason }.
    function pickHero(hero, when = new Date(), at = null) {
        const now = gmt8(when);
        const ymd = (at && at.ymd) || now.ymd;
        const phase = (at && at.phase) || phaseOf(now.hour);

        let best = null;
        let bestScore = -1;
        for (const b of (hero && hero.banners) || []) {
            if (b.active === false) continue;
            if (b.startDate && ymd < b.startDate) continue;
            if (b.endDate && ymd > b.endDate) continue;
            if (b.slot !== 'all' && b.slot !== phase) continue;
            const score = ((b.startDate || b.endDate) ? 2 : 0) + (b.slot !== 'all' ? 1 : 0);
            if (score > bestScore || (score === bestScore && best && b.id > best.id)) { best = b; bestScore = score; }
        }

        const phaseText = phase === 'day' ? '白天' : '夜晚';
        if (!best) return { img: hero ? hero.img : '', banner: null, phase, ymd, reason: '没有匹配的活动横幅，显示默认横幅' };
        const parts = [];
        if (best.startDate || best.endDate) parts.push('日期');
        parts.push(best.slot === 'all' ? '全天' : phaseText);
        return { img: best.img, banner: best, phase, ymd, reason: `${best.title ? best.title + ' · ' : ''}匹配：${parts.join(' + ')}` };
    }

    // Milliseconds until the picture may change next: 00:00 (date changes), 07:00 or 19:00 GMT+8.
    function msUntilNextChange(when = new Date()) {
        const t = new Date(when.getTime() + TZ_MS);
        const sinceMidnight = ((t.getUTCHours() * 60 + t.getUTCMinutes()) * 60 + t.getUTCSeconds()) * 1000 + t.getUTCMilliseconds();
        const marks = [0, DAY_START, NIGHT_START].map((h) => h * 3600 * 1000).concat(24 * 3600 * 1000);
        const next = marks.find((m) => m > sinceMidnight);
        return next - sinceMidnight + 500; // a little after the boundary
    }

    // ---------- listing photo gallery (the same markup is used by the site and by the admin preview) ----------
    // 1 photo: one big picture. 2 photos: two side by side.
    // 3 or more: a big picture on the left, the 2nd photo top right and the 3rd bottom right; when there are more
    // than three, the 3rd tile is blurred and shows "+N" (N = how many pictures are not shown).
    const attr = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    function galleryHtml(photos, { clickable = true } = {}) {
        const list = (photos || []).filter(Boolean);
        if (!list.length) return '';
        const shown = list.slice(0, 3);
        const more = list.length - 3;
        const tag = clickable ? 'button type="button"' : 'div';
        const close = clickable ? 'button' : 'div';
        const tiles = shown.map((p, i) => {
            const hasMore = i === 2 && more > 0;
            return `<${tag} class="g-tile${hasMore ? ' g-blur' : ''}" data-photo="${i}" aria-label="照片 ${i + 1} / ${list.length}">`
                + `<img src="${attr(resolve(p))}" alt="" loading="lazy" onload="this.classList.add('loaded')" `
                + `onerror="this.onerror=null;this.src='https://placehold.co/800x600/1e293b/ffffff?text=Luxe+Property'">`
                + (hasMore ? `<span class="g-more">+${more}</span>` : '')
                + `</${close}>`;
        }).join('');
        return `<div class="gallery" data-count="${shown.length}">${tiles}</div>`;
    }

    return { ROOT, load, resolve, gmt8, phaseOf, pickHero, msUntilNextChange, galleryHtml };
})();
