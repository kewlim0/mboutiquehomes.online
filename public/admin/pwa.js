// The admin panel as an installed app (see /admin.webmanifest). Loaded by the sign-in page and the dashboard.
// service worker: makes it installable and shows a page when offline (it stores nothing private, see /admin-sw.js)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin/' }).catch(function () { /* the panel works without it */ }); });
}
// Chrome (Android / desktop) offers "install" once through this event: keep it for the install button of the dashboard
window.adminInstall = { prompt: null, installed: false, onChange: null };
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); window.adminInstall.prompt = e; if (window.adminInstall.onChange) window.adminInstall.onChange(); });
window.addEventListener('appinstalled', function () { window.adminInstall.prompt = null; window.adminInstall.installed = true; if (window.adminInstall.onChange) window.adminInstall.onChange(); });
// app feel: no pull-to-refresh bounce, no long-press menu on buttons and icons
(function () {
    var st = document.createElement('style');
    st.textContent = 'html,body{overscroll-behavior-y:contain}button,a,.tab-btn{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}input,textarea,select{-webkit-user-select:text;user-select:text}';
    document.head.appendChild(st);
})();
