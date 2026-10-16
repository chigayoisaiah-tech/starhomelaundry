/* =====================================================================
   STARHOME — one "Sign in" box for the whole website
   • Staff / admin: email + password  → opens the admin calendar, already signed in
   • Clients:       phone + PIN       → opens My Starhome, already signed in
   Every link marked data-app-link (My Account, Client login, Staff login)
   opens this box. Needs window.STARHOME_APP_URL from starhome-config.js.
   ===================================================================== */
(function () {
  'use strict';

  function appUrl() {
    var u = window.STARHOME_APP_URL || '';
    return u.indexOf('https://script.google.com/') === 0 ? u : '';
  }

  var css = '' +
    '.shl-scrim{position:fixed;inset:0;background:rgba(6,30,41,.55);display:none;align-items:center;justify-content:center;z-index:99999;padding:16px}' +
    '.shl-scrim.open{display:flex}' +
    '.shl-box{background:#fff;color:#10283a;border-radius:18px;max-width:400px;width:100%;padding:28px 24px 22px;box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:inherit;position:relative}' +
    '.shl-box h2{margin:0 0 4px;font-size:1.5rem;color:#0A4D68}' +
    '.shl-box p.shl-sub{margin:0 0 18px;font-size:.9rem;color:#5b6b78;line-height:1.4}' +
    '.shl-box label{display:block;font-size:.75rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#3d5566;margin:12px 0 6px}' +
    '.shl-box input{width:100%;box-sizing:border-box;padding:12px 14px;border:1.5px solid #d5dde3;border-radius:10px;font-size:1rem;font-family:inherit}' +
    '.shl-box input:focus{outline:none;border-color:#0A4D68}' +
    '.shl-btn{width:100%;margin-top:18px;padding:13px;border:0;border-radius:50px;background:#0A4D68;color:#fff;font-weight:700;font-size:1rem;cursor:pointer;font-family:inherit}' +
    '.shl-btn[disabled]{opacity:.65;cursor:wait}' +
    '.shl-err{color:#b3261e;font-size:.88rem;min-height:1.2em;margin-top:10px}' +
    '.shl-x{position:absolute;top:10px;right:12px;background:none;border:0;font-size:1.6rem;line-height:1;color:#7a8a96;cursor:pointer}' +
    '.shl-help{margin-top:12px;font-size:.82rem;color:#5b6b78;text-align:center}';

  var scrim, form, idEl, pwEl, btn, err;

  function build() {
    if (scrim) return;
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    scrim = document.createElement('div');
    scrim.className = 'shl-scrim';
    scrim.setAttribute('role', 'dialog');
    scrim.setAttribute('aria-modal', 'true');
    scrim.setAttribute('aria-labelledby', 'shlTitle');
    scrim.innerHTML =
      '<form class="shl-box" novalidate>' +
        '<button type="button" class="shl-x" aria-label="Close">&times;</button>' +
        '<h2 id="shlTitle">Sign in</h2>' +
        '<p class="shl-sub">Staff: your email &amp; password.<br>Clients: your phone number &amp; PIN.</p>' +
        '<label for="shlId">Email or phone number</label>' +
        '<input id="shlId" name="username" autocomplete="username" required>' +
        '<label for="shlPw">Password or PIN</label>' +
        '<input id="shlPw" name="password" type="password" autocomplete="current-password" required>' +
        '<button class="shl-btn" type="submit">Sign in</button>' +
        '<div class="shl-err" aria-live="polite"></div>' +
        '<div class="shl-help">No login yet or forgot your PIN? WhatsApp us on 062 496 1315.</div>' +
      '</form>';
    document.body.appendChild(scrim);

    form = scrim.querySelector('form');
    idEl = scrim.querySelector('#shlId');
    pwEl = scrim.querySelector('#shlPw');
    btn = scrim.querySelector('.shl-btn');
    err = scrim.querySelector('.shl-err');

    scrim.querySelector('.shl-x').addEventListener('click', close);
    scrim.addEventListener('click', function (e) { if (e.target === scrim) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    form.addEventListener('submit', submit);
  }

  function open() {
    build();
    err.textContent = '';
    scrim.classList.add('open');
    setTimeout(function () { idEl.focus(); }, 30);
  }

  function close() {
    if (!scrim) return;
    scrim.classList.remove('open');
    pwEl.value = '';
  }

  function busy(on, label) {
    btn.disabled = on;
    btn.textContent = label || 'Sign in';
  }

  function submit(e) {
    e.preventDefault();
    var url = appUrl();
    var id = idEl.value.trim(), secret = pwEl.value;
    if (!id || !secret) { err.textContent = 'Enter your email or phone number, and your password or PIN.'; return; }
    err.textContent = '';
    busy(true, 'Signing in…');

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // avoids CORS preflight
      body: JSON.stringify({ action: 'login', id: id, secret: secret })
    })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.error) || 'Could not sign in');
        busy(true, 'Opening…');
        pwEl.value = '';
        window.location.href = url + '?page=' + encodeURIComponent(r.page) + '&sso=' + encodeURIComponent(r.code);
      })
      .catch(function (ex) {
        busy(false);
        err.textContent = ex && ex.message && !/fetch|network|JSON/i.test(ex.message)
          ? ex.message
          : 'Could not reach the booking system — please try again.';
      });
  }

  // Every login link on the site opens the one sign-in box
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-app-link]');
    if (!a || !appUrl()) return;
    e.preventDefault();
    open();
  }, true);

  window.StarhomeSignIn = { open: open, close: close };
})();
