/* ShowTrak Flow Web UI
 * Lightweight, permission-aware web surface.
 * Talks to the server '/ui' Socket.IO namespace for auth + config only.
 */
/* global io */
(function () {
  'use strict';

  const TOKEN_KEY = 'showtrak_token';

  // ---- Connection ---------------------------------------------------------
  const socket = io('/ui', {
    transports: ['websocket', 'polling'],
    auth: (cb) => cb({ token: sessionStorage.getItem(TOKEN_KEY) || undefined }),
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 4000,
    timeout: 6000,
  });

  // ---- State --------------------------------------------------------------
  let config = {
    Enabled: true,
    PasswordProtection: false,
    Authed: false,
  };
  let pin = '';
  let everConnected = false;

  // ---- Element refs -------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const el = {
    main: $('appMain'),
    loading: $('loadingOverlay'),
    login: $('loginOverlay'),
    authControls: $('authControls'),
    loginSubtitle: $('loginSubtitle'),
    disabledNotice: $('disabledNotice'),
    pinDisplay: $('pinDisplay'),
    pinError: $('pinError'),
    logoutBtn: $('logoutBtn'),
    viewToggleBtn: $('viewToggleBtn'),
    viewToggleIcon: $('viewToggleIcon'),
    viewToggleLabel: $('viewToggleLabel'),
    connDot: $('connDot'),
    connBanner: $('connBanner'),
    connBannerText: $('connBannerText'),
    confirmModal: $('confirmModal'),
    confirmText: $('confirmText'),
    confirmOk: $('confirmOk'),
    confirmCancel: $('confirmCancel'),
    toastHost: $('toastHost'),
  };

  // ---- Utilities ----------------------------------------------------------
  function safe(input) {
    if (input === null || input === undefined) return '';
    return String(input)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---- Toasts -------------------------------------------------------------
  function toast(message, type) {
    const node = document.createElement('div');
    node.className = `toast ${type || 'info'}`;
    node.textContent = message;
    el.toastHost.appendChild(node);
    setTimeout(() => {
      node.style.transition = 'opacity 200ms ease';
      node.style.opacity = '0';
      setTimeout(() => node.remove(), 220);
    }, 3200);
  }

  // ---- Confirmation -------------------------------------------------------
  let confirmHandler = null;
  function openConfirm(message, onOk) {
    el.confirmText.textContent = message || 'Are you sure?';
    confirmHandler = onOk;
    el.confirmModal.classList.remove('hidden');
  }
  function closeConfirm() {
    el.confirmModal.classList.add('hidden');
    confirmHandler = null;
  }
  el.confirmOk.addEventListener('click', () => {
    const h = confirmHandler;
    closeConfirm();
    if (h) h();
  });
  el.confirmCancel.addEventListener('click', closeConfirm);

  // ---- Connection status --------------------------------------------------
  function setConn(state) {
    el.connDot.classList.remove('online', 'offline', 'connecting');
    el.connDot.classList.add(state);
    if (state === 'online') {
      el.connDot.title = 'Connected';
      el.connBanner.classList.add('hidden');
    } else if (state === 'connecting') {
      el.connDot.title = 'Connecting…';
      if (everConnected) {
        el.connBannerText.textContent = 'Reconnecting to ShowTrak Flow…';
        el.connBanner.classList.remove('hidden');
      }
    } else {
      el.connDot.title = 'Disconnected';
      el.connBannerText.textContent = 'Lost connection to ShowTrak Flow…';
      el.connBanner.classList.remove('hidden');
    }
  }

  // ---- Auth / view gating -------------------------------------------------
  function applyAuthView() {
    const disabled = config.Enabled === false;
    const needsLogin = config.PasswordProtection && !config.Authed;
    if (disabled) {
      el.login.classList.remove('hidden');
      el.main.classList.add('hidden');
      el.loading.classList.add('hidden');
      el.logoutBtn.classList.add('hidden');
      el.loginSubtitle.textContent = 'Access is disabled in ShowTrak settings';
      el.disabledNotice.classList.remove('hidden');
      el.authControls.classList.add('hidden');
      el.pinError.classList.add('hidden');
    } else if (needsLogin) {
      el.loginSubtitle.textContent = 'Enter the access passcode';
      el.disabledNotice.classList.add('hidden');
      el.authControls.classList.remove('hidden');
      el.login.classList.remove('hidden');
      el.main.classList.add('hidden');
      el.loading.classList.add('hidden');
      el.logoutBtn.classList.add('hidden');
    } else {
      el.loginSubtitle.textContent = 'Enter the access passcode';
      el.disabledNotice.classList.add('hidden');
      el.authControls.classList.remove('hidden');
      el.login.classList.add('hidden');
      el.main.classList.remove('hidden');
      el.loading.classList.add('hidden');
      el.logoutBtn.classList.toggle('hidden', !config.PasswordProtection);
    }
  }

  // ---- Passcode keypad ----------------------------------------------------
  function renderPin() {
    const dots = el.pinDisplay.querySelectorAll('.pin-dot');
    dots.forEach((d, i) => d.classList.toggle('filled', i < pin.length));
  }
  function pinError() {
    el.pinError.classList.remove('hidden');
    el.pinDisplay.classList.add('shake');
    setTimeout(() => el.pinDisplay.classList.remove('shake'), 420);
  }
  function submitPin() {
    if (config.Enabled === false) return;
    socket.emit('auth:login', { password: pin }, (res) => {
      if (res && res.ok) {
        if (res.token) {
          sessionStorage.setItem(TOKEN_KEY, res.token);
        }
        config.Authed = true;
        pin = '';
        renderPin();
        el.pinError.classList.add('hidden');
        applyAuthView();
      } else {
        pin = '';
        renderPin();
        pinError();
      }
    });
  }
  function pushPin(digit) {
    if (pin.length >= 4) return;
    el.pinError.classList.add('hidden');
    pin += digit;
    renderPin();
    if (pin.length === 4) setTimeout(submitPin, 120);
  }
  el.login.querySelectorAll('.keypad-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-key');
      if (key === 'back') {
        pin = pin.slice(0, -1);
        renderPin();
      } else if (key === 'clear') {
        pin = '';
        renderPin();
      } else {
        pushPin(key);
      }
    });
  });
  document.addEventListener('keydown', (e) => {
    if (el.login.classList.contains('hidden')) return;
    if (e.key >= '0' && e.key <= '9') pushPin(e.key);
    else if (e.key === 'Backspace') {
      pin = pin.slice(0, -1);
      renderPin();
    } else if (e.key === 'Enter' && pin.length > 0) submitPin();
  });

  // ---- Logout -------------------------------------------------------------
  el.logoutBtn.addEventListener('click', () => {
    socket.emit('auth:logout', () => {});
    sessionStorage.removeItem(TOKEN_KEY);
    location.reload();
  });

  // ---- Compact / expanded view (local-only, default compact) --------------
  function applyViewToggle() {
    const compact = document.body.classList.contains('compact');
    el.viewToggleIcon.className = compact
      ? 'bi bi-arrows-angle-expand'
      : 'bi bi-arrows-angle-contract';
    el.viewToggleLabel.textContent = compact ? 'Expand' : 'Compact';
    el.viewToggleBtn.title = compact ? 'Switch to expanded view' : 'Switch to compact view';
  }
  el.viewToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('compact');
    applyViewToggle();
  });
  applyViewToggle();

  // ---- Socket events ------------------------------------------------------
  socket.on('connect', () => {
    everConnected = true;
    setConn('online');
  });

  socket.io.on('reconnect_attempt', () => setConn('connecting'));
  socket.io.on('reconnect', () => setConn('online'));
  socket.on('disconnect', () => setConn('offline'));
  socket.on('connect_error', () => setConn(everConnected ? 'offline' : 'connecting'));

  window.addEventListener('offline', () => setConn('offline'));
  window.addEventListener('online', () => {
    if (!socket.connected) setConn('connecting');
  });

  // Server announces auth requirements + current permissions.
  socket.on('hello', (cfg) => {
    if (cfg) config = Object.assign(config, cfg);
    applyAuthView();
  });

  // Live permission/config changes (settings updated on the server).
  socket.on('config', (cfg) => {
    if (!cfg) return;
    config = Object.assign(config, cfg);
    applyAuthView();
  });

  // Session bootstrap (config only in ShowTrak Flow).
  socket.on('bootstrap', (data) => {
    if (!data) return;
    if (data.config) config = Object.assign(config, data.config);
    applyAuthView();
  });

  // Initial connecting state
  setConn('connecting');

  // Reference utility helpers so future Flow features can wire them up
  // without tripping the linter in the meantime.
  void toast;
  void openConfirm;
  void safe;
})();
