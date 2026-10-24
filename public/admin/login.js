// Login page: 6-digit passcode. On success the server sets the session cookie and we go to the dashboard.
// (The dashboard itself is only served to a signed-in admin, see server/server.js.)
const $ = (id) => document.getElementById(id);
const passBoxes = [...document.querySelectorAll('.passcode-box')];
let loggingIn = false;

const getPasscode = () => passBoxes.map((b) => b.value).join('');

function clearPasscode() {
    passBoxes.forEach((b) => { b.value = ''; b.dataset.prev = ''; });
    passBoxes[0].focus();
}

// Right passcode: turn the boxes green from left to right, then let the page go on. Resolves when the animation is done.
function showSuccess() {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const step = calm ? 0 : 110;
    passBoxes.forEach((b, i) => setTimeout(() => b.classList.add('is-ok'), i * step));
    return new Promise((resolve) => setTimeout(resolve, (passBoxes.length - 1) * step + (calm ? 250 : 520)));
}

async function submitPasscode() {
    const passcode = getPasscode();
    if (loggingIn) return;
    if (passcode.length !== 6) { $('loginError').textContent = '请输入 6 位数字'; return; }

    loggingIn = true;
    $('loginError').textContent = '';
    $('loginBtn').disabled = true;
    passBoxes.forEach((b) => { b.disabled = true; });

    let signedIn = false;
    try {
        const res = await fetch('/api/admin/login', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passcode })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            signedIn = true;
            await showSuccess();                            // the six boxes light up green, one after the other
            window.adminSlide.go('/admin/dashboard', 'forward'); // slides left; replace: the login page is not left in the back button history
            return;
        }
        $('loginError').textContent = data.error || '登录失败，请稍后再试';
    } catch (err) {
        $('loginError').textContent = '连不上服务器，请确认网站程序在运行（npm start），并用 localhost:3000/admin 打开';
    } finally {
        loggingIn = false;
        if (!signedIn) {
            $('loginBtn').disabled = false;
            passBoxes.forEach((b) => { b.disabled = false; });
            const boxes = $('passcodeBoxes');
            boxes.classList.remove('shake');
            void boxes.offsetWidth; // restart the shake animation
            boxes.classList.add('shake');
            clearPasscode();
        }
    }
}

passBoxes.forEach((box, i) => {
    box.addEventListener('input', () => {
        const digits = box.value.replace(/\D/g, '');
        const hadDigit = box.dataset.prev || '';
        if (digits.length > 1 && !hadDigit) {
            // several digits arrived at once (autofill, password manager, fast typing): spread them over the boxes
            [...digits.slice(0, 6 - i)].forEach((d, k) => { passBoxes[i + k].value = d; passBoxes[i + k].dataset.prev = d; });
            passBoxes[Math.min(i + digits.length, 5)].focus();
        } else {
            box.value = digits.slice(-1); // one digit per box; typing over a filled box replaces it
            box.dataset.prev = box.value;
            if (box.value && i < passBoxes.length - 1) passBoxes[i + 1].focus();
        }
        if (getPasscode().length === 6) submitPasscode(); // submits by itself after the 6th digit
    });
    box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && i > 0) {
            e.preventDefault();
            passBoxes[i - 1].value = '';
            passBoxes[i - 1].dataset.prev = '';
            passBoxes[i - 1].focus();
        } else if (e.key === 'ArrowLeft' && i > 0) {
            passBoxes[i - 1].focus();
        } else if (e.key === 'ArrowRight' && i < passBoxes.length - 1) {
            passBoxes[i + 1].focus();
        }
    });
    box.addEventListener('focus', () => box.select());
    box.addEventListener('paste', (e) => {
        const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        if (!digits) return;
        e.preventDefault();
        [...digits].forEach((d, k) => { passBoxes[k].value = d; passBoxes[k].dataset.prev = d; });
        passBoxes[Math.min(digits.length, 5)].focus();
        if (digits.length === 6) submitPasscode();
    });
});

$('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    submitPasscode();
});

// Coming back with the browser's back button must not show a stale page
window.addEventListener('pageshow', (e) => { if (e.persisted) clearPasscode(); });
passBoxes[0].focus();
