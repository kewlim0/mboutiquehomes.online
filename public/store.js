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

    return { ROOT, load, resolve };
})();
