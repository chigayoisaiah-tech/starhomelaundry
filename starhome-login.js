/* =====================================================================
   STARHOME — one "Sign in / Sign up" box for the whole website
   • Staff / admin: email + password  → opens the admin calendar, already signed in
   • Clients:       phone + PIN       → opens My Starhome, already signed in
   • New clients:   Sign up (name, phone, email, own PIN) → account created,
                    then straight into My Starhome
   Links marked data-app-link="portal" / "admin" open Sign in;
   data-app-link="signup" opens Sign up.
   Needs window.STARHOME_APP_URL from starhome-config.js.
   ===================================================================== */
(function () {
  'use strict';

  function appUrl() {
    var u = window.STARHOME_APP_URL || '';
    return u.indexOf('https://script.google.com/') === 0 ? u : '';
  }

  var css = '' +
    '.shl-scrim{position:fixed;inset:0;background:rgba(6,30,41,.55);display:none;align-items:center;justify-content:center;z-index:99999;padding:16px;overflow-y:auto}' +
    '.shl-scrim.open{display:flex}' +
    '.shl-box{background:#fff;color:#10283a;border-radius:18px;max-width:400px;width:100%;padding:26px 24px 22px;box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:inherit;position:relative;margin:auto}' +
    '.shl-tabs{display:flex;background:#eef3f6;border-radius:50px;padding:4px;margin:0 32px 18px 0}' +
    '.shl-tab{flex:1;border:0;background:none;padding:9px 10px;border-radius:50px;font-weight:700;font-size:.92rem;color:#3d5566;cursor:pointer;font-family:inherit}' +
    '.shl-tab.on{background:#0A4D68;color:#fff}' +
    '.shl-box h2{margin:0 0 4px;font-size:1.45rem;color:#0A4D68}' +
    '.shl-box p.shl-sub{margin:0 0 6px;font-size:.9rem;color:#5b6b78;line-height:1.4}' +
    '.shl-box label{display:block;font-size:.75rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#3d5566;margin:12px 0 6px}' +
    '.shl-box label small{font-weight:400;text-transform:none;letter-spacing:0;color:#7a8a96}' +
    '.shl-box input{width:100%;box-sizing:border-box;padding:12px 14px;border:1.5px solid #d5dde3;border-radius:10px;font-size:1rem;font-family:inherit}' +
    '.shl-box input:focus{outline:none;border-color:#0A4D68}' +
    '.shl-btn{width:100%;margin-top:18px;padding:13px;border:0;border-radius:50px;background:#0A4D68;color:#fff;font-weight:700;font-size:1rem;cursor:pointer;font-family:inherit}' +
    '.shl-btn.alt{background:#E07B39}' +
    '.shl-btn[disabled]{opacity:.65;cursor:wait}' +
    '.shl-err{color:#b3261e;font-size:.88rem;min-height:1.2em;margin-top:10px}' +
    '.shl-x{position:absolute;top:14px;right:14px;background:none;border:0;font-size:1.6rem;line-height:1;color:#7a8a96;cursor:pointer}' +
    '.shl-help{margin-top:10px;font-size:.82rem;color:#5b6b78;text-align:center}' +
    '.shl-help a{color:#0A4D68;font-weight:700;cursor:pointer}' +
    '.shl-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}' +
    '.shl-pane[hidden]{display:none}';

  var scrim, err, panes = {}, tabs = {}, mode = 'signin';

  function build() {
    if (scrim) return;
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    scrim = document.createElement('div');
    scrim.className = 'shl-scrim';
    scrim.setAttribute('role', 'dialog');
    scrim.setAttribute('aria-modal', 'true');
    scrim.setAttribute('aria-label', 'Sign in or sign up');
    scrim.innerHTML =
      '<div class="shl-box">' +
        '<button type="button" class="shl-x" aria-label="Close">&times;</button>' +
        '<div class="shl-tabs" role="tablist">' +
          '<button type="button" class="shl-tab" data-mode="signin" role="tab">Sign in</button>' +
          '<button type="button" class="shl-tab" data-mode="signup" role="tab">Sign up</button>' +
        '</div>' +

        // ---- Sign in ----
        '<form class="shl-pane" data-pane="signin" novalidate>' +
          '<h2>Welcome back</h2>' +
          '<p class="shl-sub">Staff: your email &amp; password.<br>Clients: your phone number &amp; PIN.</p>' +
          '<label for="shlId">Email or phone number</label>' +
          '<input id="shlId" autocomplete="username" required>' +
          '<label for="shlPw">Password or PIN</label>' +
          '<input id="shlPw" type="password" autocomplete="current-password" required>' +
          '<button class="shl-btn" type="submit">Sign in</button>' +
          '<div class="shl-help">New to Starhome? <a data-go="signup">Create an account</a></div>' +
          '<div class="shl-help">Forgot your PIN? WhatsApp us on 062 496 1315.</div>' +
        '</form>' +

        // ---- Sign up (clients) ----
        '<form class="shl-pane" data-pane="signup" novalidate hidden>' +
          '<h2>Create your account</h2>' +
          '<p class="shl-sub">Book pickups and cleans, and track your orders in My Starhome.</p>' +
          '<label for="shlName">Full name</label>' +
          '<input id="shlName" autocomplete="name" required>' +
          '<label for="shlPhone">Phone number</label>' +
          '<input id="shlPhone" type="tel" autocomplete="tel" inputmode="tel" placeholder="082 123 4567" required>' +
          '<label for="shlEmail">Email <small>(optional, for booking updates)</small></label>' +
          '<input id="shlEmail" type="email" autocomplete="email">' +
          '<label for="shlPin">Choose a PIN <small>(4–6 digits)</small></label>' +
          '<input id="shlPin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="6" required>' +
          '<label for="shlPin2">Confirm PIN</label>' +
          '<input id="shlPin2" type="password" inputmode="numeric" autocomplete="new-password" maxlength="6" required>' +
          '<input class="shl-hp" id="shlWeb" tabindex="-1" autocomplete="off" aria-hidden="true">' +
          '<button class="shl-btn alt" type="submit">Sign up</button>' +
          '<div class="shl-help">Already have an account? <a data-go="signin">Sign in</a></div>' +
        '</form>' +

        '<div class="shl-err" aria-live="polite"></div>' +
      '</div>';
    document.body.appendChild(scrim);

    err = scrim.querySelector('.shl-err');
    ['signin', 'signup'].forEach(function (m) {
      panes[m] = scrim.querySelector('[data-pane="' + m + '"]');
      tabs[m] = scrim.querySelector('.shl-tab[data-mode="' + m + '"]');
      tabs[m].addEventListener('click', function () { setMode(m); });
    });
    scrim.querySelectorAll('[data-go]').forEach(function (a) {
      a.addEventListener('click', function () { setMode(a.getAttribute('data-go')); });
    });

    scrim.querySelector('.shl-x').addEventListener('click', close);
    scrim.addEventListener('click', function (e) { if (e.target === scrim) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    panes.signin.addEventListener('submit', submitSignin);
    panes.signup.addEventListener('submit', submitSignup);
  }

  function setMode(m) {
    mode = m === 'signup' ? 'signup' : 'signin';
    ['signin', 'signup'].forEach(function (k) {
      panes[k].hidden = k !== mode;
      tabs[k].classList.toggle('on', k === mode);
      tabs[k].setAttribute('aria-selected', k === mode ? 'true' : 'false');
    });
    err.textContent = '';
    var first = panes[mode].querySelector('input');
    setTimeout(function () { first.focus(); }, 30);
  }

  function open(m) {
    build();
    scrim.classList.add('open');
    setMode(m);
  }

  function close() {
    if (!scrim) return;
    scrim.classList.remove('open');
    scrim.querySelectorAll('input[type=password]').forEach(function (i) { i.value = ''; });
  }

  function val(id) { return scrim.querySelector('#' + id).value.trim(); }

  function busy(form, on, label) {
    var b = form.querySelector('.shl-btn');
    b.disabled = on;
    b.textContent = label;
  }

  function post(payload) {
    return fetch(appUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // avoids CORS preflight
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }

  function go(r) {
    if (!r || !r.ok || !r.code) throw new Error((r && r.error) || 'Something went wrong — please try again');
    window.location.href = appUrl() + '?page=' + encodeURIComponent(r.page) + '&sso=' + encodeURIComponent(r.code);
  }

  function fail(form, idle) {
    return function (ex) {
      busy(form, false, idle);
      err.textContent = ex && ex.message && !/fetch|network|JSON/i.test(ex.message)
        ? ex.message
        : 'Could not reach the booking system — please try again.';
    };
  }

  function submitSignin(e) {
    e.preventDefault();
    var f = panes.signin, id = val('shlId'), secret = scrim.querySelector('#shlPw').value;
    if (!id || !secret) { err.textContent = 'Enter your email or phone number, and your password or PIN.'; return; }
    err.textContent = '';
    busy(f, true, 'Signing in…');
    post({ action: 'login', id: id, secret: secret })
      .then(function (r) { if (r && r.ok) busy(f, true, 'Opening…'); go(r); })
      .catch(fail(f, 'Sign in'));
  }

  function submitSignup(e) {
    e.preventDefault();
    var f = panes.signup;
    var name = val('shlName'), phone = val('shlPhone'), email = val('shlEmail'),
        pin = val('shlPin'), pin2 = val('shlPin2');
    if (name.length < 2) { err.textContent = 'Enter your full name.'; return; }
    if (phone.replace(/\D/g, '').length < 9) { err.textContent = 'Enter a valid phone number.'; return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Check your email address, or leave it blank.'; return; }
    if (!/^\d{4,6}$/.test(pin)) { err.textContent = 'Your PIN must be 4–6 digits.'; return; }
    if (pin !== pin2) { err.textContent = 'The two PINs don’t match.'; return; }
    err.textContent = '';
    busy(f, true, 'Creating your account…');
    post({ action: 'signup', name: name, phone: phone, email: email, pin: pin, website: val('shlWeb') })
      .then(function (r) { if (r && r.ok) busy(f, true, 'Opening My Starhome…'); go(r); })
      .catch(fail(f, 'Sign up'));
  }

  // Every login / sign-up link on the site opens the box
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-app-link]');
    if (!a || !appUrl()) return;
    e.preventDefault();
    open(a.getAttribute('data-app-link') === 'signup' ? 'signup' : 'signin');
  }, true);

  window.StarhomeSignIn = { open: open, close: close };
})();
