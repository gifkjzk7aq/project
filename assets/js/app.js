/* 南审晴雨 · 校园共享雨伞
 * 数据库版前端：登录会话、账号切换、借还流程均由后端 SQLite 持久化。
 */
(function () {
  'use strict';

  const DATA = window.NAU_DATA;
  const ROUTES = ['home', 'stations', 'records', 'civility', 'admin'];
  const ROUTE_TITLES = {
    home: '总览',
    stations: '校园伞点',
    records: '我的借还',
    civility: '文明公约',
    admin: '运营看板'
  };
  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const app = $('#app');
  const appShell = $('#appShell');
  const loginRoot = $('#loginRoot');
  const bootScreen = $('#bootScreen');
  const modalRoot = $('#modalRoot');
  const toastStack = $('#toastStack');

  let state = emptyState();
  let flow = null;
  let demoAccounts = [];
  let demoPassword = 'nau123456';
  const ui = {
    route: getRoute(),
    zoneFilter: 'all',
    selectedStationId: null,
    stationSearch: '',
    adminSearch: '',
    zoom: 1,
    pendingRoute: null,
    busy: false
  };

  /* ------------------------------------------------------------------------
     API & state
     ------------------------------------------------------------------------ */

  function emptyState() {
    return {
      stations: [],
      users: {},
      currentUserId: null,
      activeLoans: {},
      history: {},
      activities: [],
      alerts: [],
      pledges: { count: 0, signedBy: [] },
      metrics: { todayBorrows: 0, todayReturns: 0, avgPickup: 0, activeLoans: 0, damaged: 0 },
      trend: [],
      demoAccounts: [],
      database: { engine: 'SQLite', file: 'data/nau.db' }
    };
  }

  async function api(url, options) {
    const opts = Object.assign({ credentials: 'same-origin', headers: {} }, options || {});
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const response = await fetch(url, opts);
    let payload = {};
    try {
      payload = await response.json();
    } catch (err) {
      payload = {};
    }
    if (!response.ok) {
      const error = new Error(payload.error || '请求失败，请稍后重试');
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function applyBootstrap(data) {
    const user = data.user;
    state = {
      stations: data.stations || [],
      users: user ? { [user.id]: user } : {},
      currentUserId: user ? user.id : null,
      activeLoans: user ? { [user.id]: data.loan || null } : {},
      history: user ? { [user.id]: data.history || [] } : {},
      activities: data.activities || [],
      alerts: data.alerts || [],
      pledges: {
        count: data.pledge ? data.pledge.count : 0,
        signedBy: data.pledge && data.pledge.signed && user ? [user.id] : []
      },
      metrics: data.metrics || emptyState().metrics,
      trend: data.trend || [],
      demoAccounts: data.demoAccounts || [],
      database: data.database || emptyState().database
    };
    if (Array.isArray(data.demoAccounts) && data.demoAccounts.length) {
      demoAccounts = data.demoAccounts;
    }
  }

  async function refreshData() {
    const data = await api('/api/bootstrap');
    applyBootstrap(data);
    return data;
  }

  function currentUser() {
    return state.users[state.currentUserId] || {
      id: '', name: '', role: 'student', roleLabel: '学生', department: '', detail: '',
      credit: 100, baseTrips: 0, onTimeRate: 100, avatar: '', tone: 'sage'
    };
  }

  function currentLoan() {
    return state.activeLoans[currentUser().id] || null;
  }

  function zoneOf(id) {
    return DATA.zones.find((zone) => zone.id === id) || DATA.zones[0];
  }

  function stationOf(id) {
    return state.stations.find((station) => station.id === id) || null;
  }

  function allStations() {
    return state.stations.slice().sort((a, b) => a.distance - b.distance);
  }

  function totalAvailable() {
    return state.stations.reduce((sum, station) => sum + station.available, 0);
  }

  function availableInZone(zoneId) {
    return state.stations
      .filter((station) => station.zone === zoneId)
      .reduce((sum, station) => sum + station.available, 0);
  }

  function totalCapacity() {
    return state.stations.reduce((sum, station) => sum + station.capacity, 0);
  }

  function totalDamaged() {
    return state.stations.reduce((sum, station) => sum + (station.damaged || 0), 0);
  }

  function activeLoanCount() {
    return Number(state.metrics.activeLoans) || 0;
  }

  function stockInfo(station) {
    const ratio = station.available / Math.max(1, station.capacity);
    if (ratio <= 0.52) return { label: '库存紧张', cls: 'low' };
    if (ratio <= 0.7) return { label: '库存适中', cls: 'warn' };
    return { label: '库存充足', cls: '' };
  }

  /* ------------------------------------------------------------------------
     Helpers
     ------------------------------------------------------------------------ */

  function icon(name, className) {
    return '<svg class="icon ' + (className || '') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function fmtDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function fmtDateTime(iso) {
    const date = new Date(iso);
    return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function nowLabel() {
    const now = new Date();
    return (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + WEEKDAYS[now.getDay()];
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 6) return '夜深了';
    if (hour < 9) return '早上好';
    if (hour < 12) return '上午好';
    if (hour < 14) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }

  function durationLabel(minutes) {
    const value = Math.max(0, Math.round(Number(minutes) || 0));
    if (value < 60) return value + ' 分钟';
    const hour = Math.floor(value / 60);
    const min = value % 60;
    return min ? hour + ' 小时 ' + min + ' 分' : hour + ' 小时';
  }

  function countdownParts(dueAt) {
    const diff = new Date(dueAt).getTime() - Date.now();
    if (diff <= 0) return { overdue: true, html: '<strong>已超时</strong><span>请尽快归还</span>' };
    const totalMin = Math.floor(diff / 60000);
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    return {
      overdue: false,
      html: '<strong>' + hours + '</strong><span>小时 ' + pad(mins) + ' 分后到期</span>'
    };
  }

  function getRoute() {
    const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    return ROUTES.indexOf(raw) > -1 ? raw : 'home';
  }

  function routeTitle(route) {
    return ROUTE_TITLES[route] || '总览';
  }

  function isAdmin() {
    return currentUser().role === 'admin';
  }

  /* ------------------------------------------------------------------------
     Authentication
     ------------------------------------------------------------------------ */

  function hideBoot() {
    if (!bootScreen) return;
    document.body.classList.remove('booting');
    bootScreen.classList.add('is-hidden');
    window.setTimeout(() => { bootScreen.hidden = true; }, 480);
  }

  function loginBrandSVG() {
    return (
      '<svg viewBox="0 0 52 52" aria-hidden="true">' +
        '<path d="M8 30a18 18 0 0 1 36 0H8Z" fill="currentColor"/>' +
        '<path d="M26 30v10.5a5 5 0 0 0 10 0" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>' +
        '<path d="M17 20.5 26 13l9 7.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity=".65"/>' +
        '<circle cx="40" cy="11" r="2.2" fill="#e8b25c"/>' +
      '</svg>'
    );
  }

  function loginPageHTML(errorMessage) {
    const accounts = demoAccounts.length
      ? demoAccounts.map((account) => (
          '<button class="login-account" data-action="quick-login" data-user="' + esc(account.id) + '" data-role="' + esc(account.role) + '" aria-label="以' + esc(account.name) + '身份登录">' +
            '<span class="avatar" data-tone="' + esc(account.tone) + '">' + esc(account.avatar) + '</span>' +
            '<span class="login-account-copy"><strong>' + esc(account.name) + '</strong><span>' + esc(account.department) + ' · ' + esc(account.detail) + '</span></span>' +
            '<span class="login-account-role">' + esc(account.roleLabel) + '</span>' +
          '</button>'
        )).join('')
      : '<div class="alert-empty" style="grid-column:1/-1">暂时无法读取演示账号，请检查数据库服务是否启动。</div>';

    return (
      '<div class="login-shell">' +
        '<section class="login-visual">' +
          '<div class="login-brand">' +
            '<span class="brand-mark">' + loginBrandSVG() + '</span>' +
            '<span class="login-brand-text"><strong>南审晴雨</strong><span>NAU UMBRELLA SYSTEM</span></span>' +
          '</div>' +
          '<div class="login-hero">' +
            '<p class="eyebrow on-dark">NANJING AUDIT UNIVERSITY</p>' +
            '<h1>雨天，也有人<br><span>替你留了一把伞。</span></h1>' +
            '<p>从教学楼到宿舍、食堂，10 个校园伞点共同守护每一次雨天出行。登录你的账号，借伞、还伞、积累信用，也可以运维一座校园伞网。</p>' +
            '<div class="login-roles">' +
              '<span class="login-role"><i></i>学生借还</span>' +
              '<span class="login-role"><i></i>教师借还</span>' +
              '<span class="login-role"><i></i>运维管理</span>' +
            '</div>' +
          '</div>' +
          '<div class="login-db-card">' + icon('records') +
            '<div><strong>SQLite 数据库已连接</strong><span>账号、借还记录与库存实时同步</span></div>' +
            '<b><i></i>LIVE</b>' +
          '</div>' +
        '</section>' +
        '<section class="login-form-side">' +
          '<div class="login-panel">' +
            '<p class="eyebrow">SECURE CAMPUS ACCESS</p>' +
            '<h2>登录校园伞网</h2>' +
            '<p class="login-panel-sub">选择演示身份快速进入，或使用学号 / 工号与密码登录。每个账号都有独立的借还记录与信用分。</p>' +
            '<div class="login-section-label"><span>演示账号 · 点击直接进入</span><b>' + demoAccounts.length + ' 个身份</b></div>' +
            '<div class="login-accounts">' + accounts + '</div>' +
            '<div class="login-divider">或使用学号 / 工号登录</div>' +
            '<form id="loginForm" autocomplete="on">' +
              '<div class="login-field">' +
                '<label for="loginUsername">学号 / 工号</label>' +
                '<div class="login-field-wrap">' + icon('users') + '<input id="loginUsername" name="username" type="text" inputmode="text" placeholder="例如 2023110428 或 HQ-0091" autocomplete="username" required></div>' +
              '</div>' +
              '<div class="login-field">' +
                '<label for="loginPassword">登录密码</label>' +
                '<div class="login-field-wrap">' + icon('shield') + '<input id="loginPassword" name="password" type="password" placeholder="请输入演示密码" autocomplete="current-password" required></div>' +
              '</div>' +
              '<div class="login-error" id="loginError"' + (errorMessage ? '' : ' hidden') + '>' + icon('alert') + '<span id="loginErrorText">' + esc(errorMessage || '') + '</span></div>' +
              '<button class="btn login-submit" type="submit">' + icon('shield') + '安全登录</button>' +
            '</form>' +
            '<div class="login-demo-note"><span>演示账号密码</span><b>' + esc(demoPassword) + '</b></div>' +
            '<div class="login-foot"><span>南京审计大学 · 后勤保障处</span><span class="login-legal"><span>隐私说明</span><span>使用帮助</span></span></div>' +
          '</div>' +
        '</section>' +
      '</div>'
    );
  }

  function setLoginError(message) {
    const box = $('#loginError');
    const text = $('#loginErrorText');
    if (!box || !text) return;
    text.textContent = message || '';
    box.hidden = !message;
  }

  function renderLogin(errorMessage) {
    loginRoot.innerHTML = loginPageHTML(errorMessage);
    loginRoot.hidden = false;
    appShell.hidden = true;
    document.body.classList.add('login-mode');
    document.body.classList.remove('booting');
    hideBoot();
    document.title = '登录 · 南审晴雨';
    if (window.innerWidth > 760) {
      const input = $('#loginUsername');
      if (input) input.focus({ preventScroll: true });
    }
  }

  async function showLogin(message) {
    state = emptyState();
    closeModal();
    closeMobileNav();
    appShell.hidden = true;
    loginRoot.hidden = false;
    document.body.classList.add('login-mode');
    hideBoot();
    let error = message || '';
    if (!demoAccounts.length) {
      try {
        const config = await api('/api/public-config');
        demoAccounts = config.accounts || [];
        demoPassword = config.demoPassword || demoPassword;
      } catch (err) {
        error = error || '无法连接数据库服务，请确认已通过 http://127.0.0.1:8787 打开本系统。';
      }
    }
    renderLogin(error);
  }

  async function enterApp(options) {
    const opts = options || {};
    const data = await api('/api/bootstrap');
    applyBootstrap(data);
    appShell.hidden = false;
    loginRoot.hidden = true;
    document.body.classList.remove('login-mode');
    hideBoot();
    closeModal();
    closeMobileNav();
    let route = opts.route;
    if (!route) {
      route = opts.initial ? getRoute() : (data.user.role === 'admin' ? 'admin' : 'home');
    }
    if (opts.initial && !location.hash && data.user.role === 'admin') route = 'admin';
    if (data.user.role !== 'admin' && route === 'admin') route = 'home';
    ui.route = ROUTES.indexOf(route) > -1 ? route : 'home';
    ui.zoneFilter = 'all';
    ui.selectedStationId = null;
    ui.stationSearch = '';
    ui.adminSearch = '';
    ui.pendingRoute = null;
    try {
      history.replaceState(null, '', '#/' + ui.route);
    } catch (err) {
      /* ignore */
    }
    updateChrome();
    renderPage();
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (opts.welcome) toast('已登录：' + data.user.name + ' · ' + data.user.roleLabel, 'success');
  }

  function handleApiError(err) {
    if (err && err.status === 401) {
      toast('登录状态已失效，请重新登录', 'error');
      window.setTimeout(() => { showLogin('登录状态已失效，请重新登录。'); }, 500);
      return;
    }
    toast((err && err.message) || '操作失败，请稍后重试', 'error');
  }

  async function submitLogin(username, password) {
    if (ui.busy) return;
    ui.busy = true;
    setLoginError('');
    const button = $('.login-submit');
    if (button) button.disabled = true;
    try {
      const result = await api('/api/login', { method: 'POST', body: { username, password } });
      await enterApp({
        route: result.user.role === 'admin' ? 'admin' : 'home',
        welcome: true
      });
    } catch (err) {
      setLoginError(err.status === 401 ? '账号或密码不正确，请使用演示密码 nau123456。' : (err.message || '登录失败'));
    } finally {
      ui.busy = false;
      if (button) button.disabled = false;
    }
  }

  async function quickLogin(userId) {
    if (ui.busy) return;
    const account = demoAccounts.find((item) => item.id === userId);
    if (!account) return;
    ui.busy = true;
    const button = $('.login-account[data-user="' + userId + '"]');
    if (button) button.disabled = true;
    try {
      await api('/api/demo-login', { method: 'POST', body: { userId } });
      await enterApp({
        route: account.role === 'admin' ? 'admin' : 'home',
        welcome: true
      });
    } catch (err) {
      setLoginError(err.message || '登录失败，请稍后再试');
    } finally {
      ui.busy = false;
      if (button) button.disabled = false;
    }
  }

  async function switchAccount(userId) {
    if (ui.busy) return;
    const account = state.demoAccounts.find((item) => item.id === userId);
    if (!account) return;
    if (userId === currentUser().id) {
      closeModal();
      return;
    }
    ui.busy = true;
    try {
      await api('/api/demo-login', { method: 'POST', body: { userId } });
      const pending = ui.pendingRoute;
      closeModal();
      await enterApp({
        route: account.role === 'admin' ? 'admin' : 'home',
        welcome: false
      });
      toast('已切换为' + account.name + ' · ' + account.roleLabel, 'success');
      if (pending === 'admin' && account.role !== 'admin') {
        toast('该账号没有运营看板权限', 'error');
      }
    } catch (err) {
      handleApiError(err);
    } finally {
      ui.busy = false;
    }
  }

  async function logout() {
    if (ui.busy) return;
    ui.busy = true;
    try {
      await api('/api/logout', { method: 'POST' });
    } catch (err) {
      /* 即使网络异常也退出前端会话 */
    }
    ui.busy = false;
    state = emptyState();
    closeModal();
    await showLogin();
    toast('已安全退出登录');
  }

  /* ------------------------------------------------------------------------
     Toast & modal
     ------------------------------------------------------------------------ */

  function toast(message, type) {
    const node = document.createElement('div');
    node.className = 'toast ' + (type || '');
    const iconName = type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info';
    node.innerHTML = icon(iconName) + '<span>' + esc(message) + '</span>';
    toastStack.appendChild(node);
    window.setTimeout(() => {
      node.classList.add('leaving');
      window.setTimeout(() => node.remove(), 260);
    }, 3200);
  }

  function openModal(content, size) {
    modalRoot.innerHTML =
      '<div class="modal-layer" data-action="modal-backdrop">' +
        '<div class="modal ' + (size || '') + '" role="dialog" aria-modal="true" aria-label="校园雨伞服务弹窗" tabindex="-1">' +
          content +
        '</div>' +
      '</div>';
    document.body.classList.add('modal-open');
    window.setTimeout(() => {
      const target = $('.modal', modalRoot);
      if (target) target.focus({ preventScroll: true });
    }, 30);
  }

  function setModalContent(content) {
    const modal = $('.modal', modalRoot);
    if (!modal) {
      openModal(content);
      return;
    }
    modal.innerHTML = content;
  }

  function closeModal() {
    modalRoot.innerHTML = '';
    document.body.classList.remove('modal-open');
  }

  function openNotifications() {
    const alerts = state.alerts.filter((alert) => !alert.resolved);
    const items = alerts.length
      ? alerts.map((alert) => {
          const st = alert.stationId ? stationOf(alert.stationId) : null;
          return (
            '<div class="notice-item">' +
              '<span class="notice-icon">' + icon(alert.level === 'danger' ? 'alert' : alert.level === 'info' ? 'info' : 'cloud-rain') + '</span>' +
              '<div class="notice-copy">' +
                '<strong>' + esc(alert.title) + '</strong>' +
                '<p>' + esc(alert.desc) + '</p>' +
                '<span>' + esc(alert.time) + (st ? ' · ' + esc(st.name) : '') + '</span>' +
              '</div>' +
            '</div>'
          );
        }).join('')
      : '<div class="alert-empty">今天的伞网运行平稳，没有新的待处理消息。</div>';

    openModal(
      '<div class="modal-head">' +
        '<div><p class="eyebrow">NOTIFICATIONS</p><h2>消息与提醒</h2><p>校园伞网 · 实时运行信息</p></div>' +
        '<button class="modal-close" data-action="close-modal" aria-label="关闭">' + icon('close') + '</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="notice-item">' +
          '<span class="notice-icon">' + icon('cloud-rain') + '</span>' +
          '<div class="notice-copy"><strong>南京市气象台 · 降雨提醒</strong><p>' + esc(DATA.weather.alert) + '</p><span>' + DATA.weather.updated + ' 更新</span></div>' +
        '</div>' +
        '<div class="notice-list" style="margin-top:9px">' + items + '</div>' +
      '</div>' +
      '<div class="modal-foot"><span class="modal-foot-note">消息每 30 秒自动刷新</span><div class="modal-foot-actions"><button class="btn btn-dark btn-sm" data-action="close-modal">知道了</button></div></div>',
      'modal-sm'
    );
  }

  function openIdentity(pendingRoute) {
    ui.pendingRoute = pendingRoute || null;
    const accounts = state.demoAccounts.length ? state.demoAccounts : demoAccounts;
    const adminAccount = accounts.find((account) => account.role === 'admin');
    const items = accounts.map((account) => {
      const active = account.id === currentUser().id;
      return (
        '<button class="identity-option ' + (active ? 'active' : '') + '" data-action="switch-account" data-user="' + esc(account.id) + '">' +
          '<span class="avatar" data-tone="' + esc(account.tone) + '">' + esc(account.avatar) + '</span>' +
          '<span class="identity-meta"><strong>' + esc(account.name) + '</strong><span>' + esc(account.department) + ' · ' + esc(account.detail) + '</span></span>' +
          '<span class="identity-role">' + esc(account.roleLabel) + '</span>' +
          (active ? icon('check') : '') +
        '</button>'
      );
    }).join('');

    const pendingNote = pendingRoute === 'admin'
      ? '<div class="identity-note">' + icon('shield') + '<span>运营看板仅对后勤运维开放。切换至<strong>' + esc(adminAccount ? adminAccount.name : '运维账号') + ' · 运维</strong>即可查看库存、补货和告警处理。</span></div>'
      : '';

    openModal(
      '<div class="modal-head">' +
        '<div><p class="eyebrow">DATABASE ACCOUNTS</p><h2>切换登录账号</h2><p>所有账号共用一份 SQLite 数据库，数据实时同步</p></div>' +
        '<button class="modal-close" data-action="close-modal" aria-label="关闭">' + icon('close') + '</button>' +
      '</div>' +
      '<div class="modal-body">' +
        pendingNote +
        '<div class="identity-list" style="margin-top:' + (pendingNote ? '12px' : '0') + '">' + items + '</div>' +
        '<div class="identity-note">' + icon('info') + '<span>切换账号不需要重复输入密码。你可以在学生端借伞，再用运维账号查看库存变化；每条操作都会写入数据库。</span></div>' +
      '</div>' +
      '<div class="modal-foot">' +
        '<div style="display:flex;align-items:center;gap:14px">' +
          '<button class="text-link" data-action="logout" style="font-size:9px;color:var(--muted-light)">' + icon('logout') + '退出登录</button>' +
          (isAdmin() ? '<button class="text-link" data-action="reset-demo" style="font-size:9px;color:var(--muted-light)">' + icon('refresh') + '重置数据</button>' : '') +
        '</div>' +
        '<div class="modal-foot-actions"><button class="btn btn-outline btn-sm" data-action="close-modal">取消</button></div>' +
      '</div>',
      'modal-sm'
    );
  }

  /* ------------------------------------------------------------------------
     Navigation & rendering
     ------------------------------------------------------------------------ */

  function go(route) {
    if (ROUTES.indexOf(route) < 0) route = 'home';
    if (route === 'admin' && !isAdmin()) {
      openIdentity('admin');
      return;
    }
    closeMobileNav();
    if (location.hash.replace(/^#\/?/, '') === route) {
      ui.route = route;
      renderAll();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    location.hash = '#/' + route;
  }

  function handleHashChange() {
    if (!state.currentUserId) return;
    let route = getRoute();
    if (route === 'admin' && !isAdmin()) {
      toast('运营看板需要后勤运维身份', 'error');
      openIdentity('admin');
      route = 'home';
      try {
        history.replaceState(null, '', '#/home');
      } catch (err) {
        /* file:// 下若不允许修改历史记录，保持当前页面即可 */
      }
    }
    ui.route = route;
    renderAll();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function openMobileNav() {
    document.body.classList.add('nav-open');
  }

  function closeMobileNav() {
    document.body.classList.remove('nav-open');
  }

  function updateChrome() {
    const user = currentUser();
    const loan = currentLoan();
    $('#sideAvatar').textContent = user.avatar;
    $('#sideAvatar').dataset.tone = user.tone;
    $('#sideUserName').textContent = user.name;
    $('#sideUserRole').textContent = user.roleLabel + ' · ' + user.department;
    $('#topAvatar').textContent = user.avatar;
    $('#topAvatar').dataset.tone = user.tone;
    $('#topUserName').textContent = user.name;
    $('#navStationCount').textContent = state.stations.length;
    $('#navLoanDot').hidden = !loan;
    $('#topbarDate').textContent = nowLabel();
    const dockBorrow = $('.dock-borrow');
    if (dockBorrow) dockBorrow.style.display = isAdmin() ? 'none' : 'grid';

    $$('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.route === ui.route);
    });
    $$('.dock-item[data-route]').forEach((item) => {
      item.classList.toggle('active', item.dataset.route === ui.route);
    });
    document.title = '南审晴雨 · ' + routeTitle(ui.route);
  }

  function renderAll() {
    updateChrome();
    renderPage();
  }

  function renderPage() {
    let html = '';
    switch (ui.route) {
      case 'stations':
        html = stationsPage();
        break;
      case 'records':
        html = recordsPage();
        break;
      case 'civility':
        html = civilityPage();
        break;
      case 'admin':
        html = isAdmin() ? adminPage() : homePage();
        break;
      default:
        html = homePage();
    }
    app.innerHTML = html;
    app.classList.remove('page-enter');
    void app.offsetWidth;
    app.classList.add('page-enter');
    updateChrome();
  }

  function animateNumbers() {
    $$('[data-count]').forEach((node) => {
      const target = Number(node.dataset.count);
      if (!Number.isFinite(target)) return;
      const start = performance.now();
      const duration = 720;
      const step = (time) => {
        const progress = Math.min(1, (time - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        node.textContent = Math.round(target * eased);
        if (progress < 1) requestAnimationFrame(step);
      };
      node.textContent = '0';
      requestAnimationFrame(step);
    });
  }

  /* ------------------------------------------------------------------------
     Home
     ------------------------------------------------------------------------ */

  function homePage() {
    const user = currentUser();
    const available = totalAvailable();
    const loan = currentLoan();
    const rate = Math.round((state.metrics.todayReturns / Math.max(1, state.metrics.todayBorrows)) * 100);
    return (
      '<section class="home-intro">' +
        '<div>' +
          '<p class="eyebrow">NAU · RAINY DAY SERVICE</p>' +
          '<h1>' + greeting() + '，<span>' + esc(user.name) + '</span>。</h1>' +
          '<p class="home-intro-sub">' + icon('cloud-rain') + ' 南京中雨 17°C，雨势将在 21:00 后逐渐减弱</p>' +
        '</div>' +
        '<div class="rain-bulletin">' +
          '<span class="rain-bulletin-icon">' + icon('alert') + '</span>' +
          '<div><p>南京市气象台提醒：晚自习时段仍有降雨，请携带雨具。</p><span>' + DATA.weather.updated + ' 更新 · 浦口校区</span></div>' +
        '</div>' +
      '</section>' +
      heroHTML(available) +
      '<div class="stat-row">' +
        statCard('umbrella', '可借雨伞', available, '把', '较今日清晨 <b>+12</b>') +
        statCard('records', '今日借还', state.metrics.todayBorrows, '次', '归还率 <b>' + rate + '%</b>') +
        statCard('pin', '服务伞点', state.stations.length, '个', '覆盖 <b>3</b> 大区域') +
        statCard('clock', '平均取伞', state.metrics.avgPickup, '分钟', '最近伞点 <b>120</b> 米') +
      '</div>' +
      '<div class="home-lower">' +
        mapCardHTML('home') +
        '<aside class="home-side">' +
          activityCardHTML() +
          '<div class="civility-mini">' +
            '<span>THE UMBRELLA PROMISE</span>' +
            '<h3>一把伞的旅程，<br>从文明借还开始。</h3>' +
            '<p>已有 ' + state.pledges.count.toLocaleString('zh-CN') + ' 位南审人签署文明公约</p>' +
            '<button data-route="civility">' + icon('arrow-right') + ' 读一读我们的约定</button>' +
          '</div>' +
        '</aside>' +
      '</div>'
    );
  }

  function statCard(iconName, label, value, unit, foot) {
    const animate = Number.isInteger(Number(value)) ? ' data-count="' + value + '"' : '';
    return (
      '<div class="stat-card">' +
        '<div class="stat-card-top"><span>' + label + '</span><span class="stat-icon">' + icon(iconName) + '</span></div>' +
        '<div class="stat-value"><strong' + animate + '>' + value + '</strong><span>' + unit + '</span></div>' +
        '<div class="stat-foot">' + foot + '</div>' +
      '</div>'
    );
  }

  function heroHTML(available) {
    const admin = isAdmin();
    return (
      '<section class="hero">' +
        '<div class="hero-copy">' +
          '<span class="hero-tag"><b></b>' + icon('cloud-rain') + ' 雨天服务进行中</span>' +
          '<h1>雨落南审，<br><span>伞已在等你。</span></h1>' +
          '<p class="hero-desc">从教学楼到宿舍、食堂，校园里的每个雨天，都有一把伞替你挡一挡。免押金借用，48 小时内归还，把方便留给下一位。</p>' +
          '<div class="hero-actions">' +
            (admin
              ? '<button class="btn btn-primary" data-route="admin">' + icon('chart') + '进入运营看板</button>'
              : '<button class="btn btn-primary" data-action="open-borrow">' + icon('umbrella') + (currentLoan() ? '查看我的借还' : '立即借一把伞') + '</button>') +
            '<button class="btn btn-outline" data-route="stations">看看附近伞点' + icon('arrow-right') + '</button>' +
          '</div>' +
          '<div class="hero-proof">' +
            '<span class="hero-avatars"><span>林</span><span>陈</span><span>周</span></span>' +
            '<span>此刻已有 <b>326</b> 位师生在雨中安全出行</span>' +
          '</div>' +
        '</div>' +
        '<div class="hero-visual" aria-hidden="true">' +
          heroArt() +
          '<div class="hero-weather-card">' + icon('droplet') + '<strong>中雨 17°C</strong><span>体感 16°C</span></div>' +
          '<div class="hero-orbit hero-orbit-a"><i></i>教学区 · ' + availableInZone('teaching') + ' 把</div>' +
          '<div class="hero-orbit hero-orbit-b"><i></i>宿舍区 · ' + availableInZone('dorm') + ' 把</div>' +
          '<div class="hero-orbit hero-orbit-c"><i></i>食堂 · ' + availableInZone('canteen') + ' 把</div>' +
          '<div class="hero-live-card">' +
            '<span>此刻全校可借</span>' +
            '<div class="hero-live-row"><strong>' + available + '</strong><small>把雨伞</small></div>' +
            '<i></i>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function heroArt() {
    return (
      '<svg class="hero-art" viewBox="0 0 520 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
        '<defs>' +
          '<radialGradient id="heroHalo" cx="50%" cy="50%" r="50%">' +
            '<stop offset="0%" stop-color="#e6ad55" stop-opacity=".58"/>' +
            '<stop offset="62%" stop-color="#d8953d" stop-opacity=".16"/>' +
            '<stop offset="100%" stop-color="#d8953d" stop-opacity="0"/>' +
          '</radialGradient>' +
          '<linearGradient id="coatGrad" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#ecdbb6"/>' +
            '<stop offset="100%" stop-color="#d6bf92"/>' +
          '</linearGradient>' +
          '<linearGradient id="canopyGrad" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0%" stop-color="#f7ecd3"/>' +
            '<stop offset="100%" stop-color="#e7d3a8"/>' +
          '</linearGradient>' +
          '<clipPath id="canopyClip">' +
            '<path d="M95 178C125 92 195 58 260 62C335 66 390 112 415 178C392 164 370 164 352 178C330 163 307 163 289 178C268 163 244 163 224 178C205 163 181 163 162 178C144 163 120 163 95 178Z"/>' +
          '</clipPath>' +
        '</defs>' +
        '<circle cx="300" cy="174" r="164" fill="url(#heroHalo)"/>' +
        '<g opacity=".18" fill="#f7f0df">' +
          '<path d="M35 115c10-16 32-20 47-9 9-12 28-13 38-2 16-7 34 4 34 19H35Z"/>' +
          '<path d="M405 98c7-12 24-15 35-7 8-8 22-7 28 2 10-2 19 6 19 15h-82Z"/>' +
        '</g>' +
        '<g class="rain">' +
          '<line class="rain-line" x1="58" y1="45" x2="52" y2="66"/><line class="rain-line" x1="105" y1="28" x2="99" y2="49"/>' +
          '<line class="rain-line" x1="154" y1="44" x2="148" y2="65"/><line class="rain-line" x1="390" y1="42" x2="384" y2="63"/>' +
          '<line class="rain-line" x1="438" y1="68" x2="432" y2="89"/><line class="rain-line" x1="479" y1="40" x2="473" y2="61"/>' +
          '<line class="rain-line" x1="82" y1="206" x2="76" y2="227"/><line class="rain-line" x1="128" y1="230" x2="122" y2="251"/>' +
          '<line class="rain-line" x1="414" y1="210" x2="408" y2="231"/><line class="rain-line" x1="455" y1="243" x2="449" y2="264"/>' +
          '<line class="rain-line" x1="66" y1="302" x2="60" y2="323"/><line class="rain-line" x1="392" y1="300" x2="386" y2="321"/>' +
          '<line class="rain-line" x1="348" y1="42" x2="342" y2="63"/><line class="rain-line" x1="230" y1="34" x2="224" y2="55"/>' +
        '</g>' +
        '<g opacity=".45" fill="#12372e">' +
          '<path d="M0 348h72v-45h18v45h26v-77h22v77h34v-59h19v59h28v-35h20v35h35v-58h24v58h39v-43h20v43h48v-72h26v72h33v-34h26v34h31v20H0Z"/>' +
        '</g>' +
        '<g class="puddle">' +
          '<ellipse cx="287" cy="377" rx="155" ry="17" fill="#0c2b24" opacity=".33"/>' +
          '<ellipse cx="256" cy="374" rx="71" ry="6" fill="none" stroke="#b2cbc2" stroke-opacity=".3"/>' +
          '<ellipse cx="357" cy="381" rx="46" ry="4" fill="none" stroke="#b2cbc2" stroke-opacity=".22"/>' +
        '</g>' +
        '<g class="character">' +
          '<path d="M302 321l-14 35" stroke="#142e28" stroke-width="10" stroke-linecap="round"/>' +
          '<path d="M328 321l5 36" stroke="#1a352e" stroke-width="10" stroke-linecap="round"/>' +
          '<path d="M278 350h23v7h-23zM327 352h21v7h-21z" fill="#0c241e" rx="3"/>' +
          '<path d="M267 246c-18 11-23 38-17 61l22 4 9-22" fill="#a75f45"/>' +
          '<path d="M279 225c11-13 48-14 64 2 7 24 7 61 2 96-17 9-51 9-68 0-5-34-5-73 2-98Z" fill="url(#coatGrad)"/>' +
          '<path d="M292 229c14 12 29 12 43 0l8 13c-17 14-43 14-59 0l8-13Z" fill="#c77a52"/>' +
          '<path d="M312 245v77" stroke="#bfa97f" stroke-width="2.4" opacity=".6"/>' +
          '<circle cx="314" cy="193" r="20" fill="#e8b48e"/>' +
          '<path d="M294 191c1-19 12-29 27-27 12 2 18 11 18 24-7-6-14-8-22-8-8 0-15 3-23 11Z" fill="#292b27"/>' +
          '<circle cx="333" cy="174" r="9" fill="#292b27"/>' +
          '<path d="M358 253c-15 6-33 14-48 23" fill="none" stroke="#e1c798" stroke-width="12" stroke-linecap="round"/>' +
          '<path d="M311 276c-8-2-15-7-21-15" fill="none" stroke="#e8b48e" stroke-width="9" stroke-linecap="round"/>' +
          '<circle cx="287" cy="259" r="5.5" fill="#e8b48e"/>' +
        '</g>' +
        '<g transform="rotate(2.5 260 170)">' +
          '<path d="M260 44v15" stroke="#e8dbbd" stroke-width="3" stroke-linecap="round"/>' +
          '<path d="M95 178C125 92 195 58 260 62C335 66 390 112 415 178C392 164 370 164 352 178C330 163 307 163 289 178C268 163 244 163 224 178C205 163 181 163 162 178C144 163 120 163 95 178Z" fill="url(#canopyGrad)" stroke="#f9f2e3" stroke-width="1.4"/>' +
          '<g clip-path="url(#canopyClip)">' +
            '<path d="M260 62L352 178C330 163 307 163 289 178Z" fill="#d99d43" opacity=".82"/>' +
            '<path d="M260 62L224 178C244 163 268 163 289 178Z" fill="#4e806b" opacity=".68"/>' +
            '<path d="M260 62L162 178C181 163 205 163 224 178Z" fill="#c9863f" opacity=".36"/>' +
            '<path d="M260 62L95 178C120 163 144 163 162 178Z" fill="#f2e3c5" opacity=".5"/>' +
            '<path d="M260 62L415 178C392 164 370 164 352 178Z" fill="#f4e6c9" opacity=".55"/>' +
          '</g>' +
          '<path d="M260 64L95 178M260 64L162 178M260 64L224 178M260 64L289 178M260 64L352 178M260 64L415 178" stroke="#8f6a37" stroke-width="1.2" opacity=".35"/>' +
          '<path d="M260 168v139c0 17 19 23 30 11" fill="none" stroke="#eadfc8" stroke-width="3.2" stroke-linecap="round"/>' +
          '<circle cx="260" cy="61" r="3" fill="#f6e9cf"/>' +
        '</g>' +
        '<circle cx="435" cy="315" r="3" fill="#e6ad55" opacity=".8"/>' +
        '<circle cx="435" cy="315" r="8" fill="none" stroke="#e6ad55" stroke-opacity=".25"/>' +
      '</svg>'
    );
  }

  function activityCardHTML() {
    const items = state.activities.slice(0, 4).map((activity) => (
      '<div class="activity-item">' +
        '<span class="activity-avatar" data-tone="' + esc(activity.tone) + '">' + esc(activity.name.slice(0, 1)) + '</span>' +
        '<div class="activity-body"><p><b>' + esc(activity.name) + '</b> ' + esc(activity.action) + ' · ' + esc(activity.station) + '</p><span>' + esc(activity.detail) + '</span></div>' +
        '<span class="activity-time">' + esc(activity.time) + '</span>' +
      '</div>'
    )).join('');

    return (
      '<div class="activity-card">' +
        '<div class="activity-head"><h2>伞网动态</h2><span class="activity-live"><i></i>实时</span></div>' +
        '<div class="activity-list">' + items + '</div>' +
        '<button class="activity-more" data-action="open-notifications">查看全部动态' + icon('arrow-right') + '</button>' +
      '</div>'
    );
  }

  /* ------------------------------------------------------------------------
     Map
     ------------------------------------------------------------------------ */

  function getMapStations() {
    const sorted = allStations();
    if (ui.zoneFilter === 'all') return sorted;
    return sorted.filter((station) => station.zone === ui.zoneFilter);
  }

  function normalizeSelection(list) {
    if (!list.length) {
      ui.selectedStationId = null;
      return;
    }
    if (!list.some((station) => station.id === ui.selectedStationId)) {
      ui.selectedStationId = list[0].id;
    }
  }

  function mapCardHTML(context) {
    const mapStations = getMapStations();
    normalizeSelection(mapStations);
    const selected = stationOf(ui.selectedStationId) || mapStations[0];
    const isHome = context === 'home';
    const zones = [{ id: 'all', name: '全部' }].concat(DATA.zones.map((zone) => ({ id: zone.id, name: zone.short })));
    const filters = zones.map((zone) => (
      '<button class="zone-filter ' + (ui.zoneFilter === zone.id ? 'active' : '') + '" data-action="filter-zone" data-zone="' + zone.id + '">' + zone.name + '</button>'
    )).join('');

    return (
      '<section class="map-card">' +
        '<div class="map-card-head">' +
          '<div><h2>' + (isHome ? '校园伞网' : '实时伞点地图') + '</h2><p>点击地图上的伞点，查看库存与步行距离</p></div>' +
          '<div class="zone-filters" role="group" aria-label="按区域筛选">' + filters + '</div>' +
        '</div>' +
        '<div class="map-frame">' +
          '<div class="campus-map" id="campusMap">' +
            '<div class="map-stage" id="mapStage" style="transform:scale(' + ui.zoom + ')">' +
              mapSVG() +
              '<div id="mapPins">' + mapPinsHTML(mapStations) + '</div>' +
              '<span class="map-caption">南京审计大学浦口校区 · 伞点分布示意图</span>' +
            '</div>' +
            '<div class="map-tools" role="group" aria-label="地图缩放">' +
              '<button data-action="zoom-map" data-step="0.1" aria-label="放大地图">' + icon('plus') + '</button>' +
              '<button data-action="zoom-map" data-step="-0.1" aria-label="缩小地图">' + icon('minus') + '</button>' +
              '<button data-action="zoom-map" data-step="reset" aria-label="复位地图">' + icon('locate') + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="map-spot' + (selected ? '' : ' map-spot-prompt') + '" id="mapSpot">' + (selected ? mapSpotHTML(selected) : mapSpotEmptyHTML()) + '</div>' +
        '</div>' +
        '<div class="map-legend">' +
          DATA.zones.map((zone) => '<span style="--legend-color:' + zone.color + '"><i></i>' + zone.name + '</span>').join('') +
          '<b>共 ' + state.stations.length + ' 个伞点 · 数据实时同步</b>' +
        '</div>' +
        (isHome
          ? '<div style="display:flex;justify-content:flex-end;margin-top:9px"><button class="text-link" data-route="stations">查看全部伞点' + icon('arrow-right') + '</button></div>'
          : '') +
      '</section>'
    );
  }

  function mapPinsHTML(stations) {
    return stations.map((station) => {
      const zone = zoneOf(station.zone);
      const stock = stockInfo(station);
      return (
        '<button class="map-pin ' + (station.id === ui.selectedStationId ? 'is-active ' : '') + (stock.cls === 'low' ? 'is-low' : '') + '" ' +
          'style="left:' + station.x + '%;top:' + station.y + '%;--pin-color:' + zone.color + '" ' +
          'data-action="select-station" data-station="' + station.id + '" aria-label="' + esc(station.name) + '，可借 ' + station.available + ' 把">' +
          '<span class="map-pin-body">' + icon('umbrella') + '<span class="map-pin-count">' + station.available + '</span></span>' +
          '<span class="map-pin-label">' + esc(station.name) + '</span>' +
        '</button>'
      );
    }).join('');
  }

  function mapSpotHTML(station) {
    const zone = zoneOf(station.zone);
    const stock = stockInfo(station);
    const loan = currentLoan();
    const action = isAdmin()
      ? '<button class="btn btn-dark btn-sm btn-block" data-route="admin">' + icon('chart') + '前往运营看板</button>'
      : loan
        ? '<button class="btn btn-outline btn-sm btn-block" data-action="open-return">你有一把伞待归还' + icon('arrow-right') + '</button>'
        : '<button class="btn btn-primary btn-sm btn-block" data-action="borrow-at" data-station="' + station.id + '"' + (station.available <= 0 ? ' disabled' : '') + '>' +
            (station.available <= 0 ? '暂无可借雨伞' : '在这里借伞' + icon('arrow-right')) +
          '</button>';
    return (
      '<div class="map-spot-head">' +
        '<div>' +
          '<span class="zone-tag" style="--zone-color:' + zone.color + ';--zone-soft:' + zone.soft + '"><i></i>' + zone.name + '</span>' +
          '<h3>' + esc(station.name) + '</h3>' +
        '</div>' +
        '<button class="map-spot-close" data-action="close-spot" aria-label="关闭伞点详情">' + icon('close') + '</button>' +
      '</div>' +
      '<div class="map-spot-meta">' + icon('navigation') + '<span>距你 ' + station.distance + ' 米 · 步行 ' + station.walk + ' 分钟</span></div>' +
      '<div class="map-spot-inventory">' +
        '<div><strong>' + station.available + '<small>把可借</small></strong><span> / 共 ' + station.capacity + ' 把</span></div>' +
        '<span class="stock-tag ' + (stock.cls === 'low' ? 'low' : stock.cls) + '">' + stock.label + '</span>' +
      '</div>' +
      action +
      '<div class="map-spot-meta" style="margin-top:7px">' + icon('clock') + '<span>' + station.hours + ' · ' + station.note + '</span></div>'
    );
  }

  function mapSpotEmptyHTML() {
    return '<span>点击地图上的雨伞标记</span><strong>查看该伞点实时库存</strong>';
  }

  function selectStation(id) {
    const station = stationOf(id);
    if (!station) return;
    ui.selectedStationId = id;
    $$('.map-pin').forEach((pin) => {
      pin.classList.toggle('is-active', pin.dataset.station === id);
    });
    const spot = $('#mapSpot');
    if (spot) {
      spot.style.display = '';
      spot.classList.remove('map-spot-prompt');
      spot.innerHTML = mapSpotHTML(station);
    }
  }

  function closeSpot() {
    ui.selectedStationId = null;
    $$('.map-pin').forEach((pin) => pin.classList.remove('is-active'));
    const spot = $('#mapSpot');
    if (spot) {
      spot.classList.add('map-spot-prompt');
      spot.innerHTML = mapSpotEmptyHTML();
      spot.style.display = '';
    }
  }

  function mapSVG() {
    const trees = [
      [108, 188], [122, 250], [270, 105], [310, 245], [330, 400], [390, 205],
      [430, 250], [560, 458], [620, 470], [720, 160], [740, 205], [890, 330],
      [930, 410], [980, 300], [1030, 450], [1040, 250], [250, 470], [160, 510],
      [690, 520], [1100, 180], [1150, 330], [525, 120], [465, 500], [835, 185]
    ].map(([x, y]) => (
      '<g class="map-tree" transform="translate(' + x + ' ' + y + ')">' +
        '<circle r="10" fill="#b8ccb7" opacity=".72"/><circle cx="5" cy="-4" r="6" fill="#c6d7c2" opacity=".66"/>' +
      '</g>'
    )).join('');

    function building(x, y, w, h, label, sub) {
      return (
        '<g class="map-building">' +
          '<rect x="' + x + '" y="' + (y + 4) + '" width="' + w + '" height="' + h + '" rx="7" fill="#c8d1c4" opacity=".45"/>' +
          '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="7" fill="#f8f5ec" stroke="#cbd5c9" stroke-width="1.2"/>' +
          '<path d="M' + (x + 14) + ' ' + (y + 16) + 'H' + (x + w - 14) + 'M' + (x + 14) + ' ' + (y + 23) + 'H' + (x + w - 34) + '" stroke="#dfe5dc" stroke-width="2" stroke-linecap="round"/>' +
          '<text x="' + (x + w / 2) + '" y="' + (y + h / 2 + 3) + '" text-anchor="middle" fill="#43594f" font-size="16.5" font-family="Noto Serif SC, STSong, SimSun, serif">' + label + '</text>' +
          (sub ? '<text x="' + (x + w / 2) + '" y="' + (y + h / 2 + 21) + '" text-anchor="middle" fill="#87978d" font-size="9.5" font-family="Microsoft YaHei, sans-serif">' + sub + '</text>' : '') +
        '</g>'
      );
    }

    return (
      '<svg class="map-canvas" viewBox="0 0 1200 620" preserveAspectRatio="none" role="img" aria-label="南京审计大学浦口校区伞点分布地图">' +
        '<defs>' +
          '<linearGradient id="waterGrad" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0%" stop-color="#c5dcda"/><stop offset="100%" stop-color="#a9cbc9"/>' +
          '</linearGradient>' +
          '<linearGradient id="grassGrad" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0%" stop-color="#edf2e8"/><stop offset="100%" stop-color="#e4ece1"/>' +
          '</linearGradient>' +
          '<pattern id="mapTexture" width="26" height="26" patternUnits="userSpaceOnUse">' +
            '<circle cx="3" cy="3" r=".8" fill="#9caf9c" opacity=".2"/>' +
          '</pattern>' +
          '<filter id="mapBuildingShadow" x="-20%" y="-20%" width="140%" height="140%">' +
            '<feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#355247" flood-opacity=".1"/>' +
          '</filter>' +
        '</defs>' +
        '<rect width="1200" height="620" fill="url(#grassGrad)"/>' +
        '<rect width="1200" height="620" fill="url(#mapTexture)"/>' +
        '<path d="M86 113C195 51 382 43 533 68C668 91 792 78 949 96C1087 112 1137 197 1144 298C1152 423 1082 527 947 562C806 598 688 568 557 575C406 583 256 594 151 520C65 460 57 331 62 239C66 177 59 136 86 113Z" fill="#e8efe2" stroke="#d2ddd0" stroke-width="2"/>' +
        '<path d="M114 130C203 74 366 62 518 84C671 106 809 92 963 112C1074 126 1121 202 1123 300C1126 409 1065 503 935 536C790 572 674 544 545 552C397 561 256 569 166 505C91 451 83 334 88 244C92 184 90 153 114 130Z" fill="none" stroke="#f8f4e9" stroke-width="30"/>' +
        '<path d="M114 130C203 74 366 62 518 84C671 106 809 92 963 112C1074 126 1121 202 1123 300C1126 409 1065 503 935 536C790 572 674 544 545 552C397 561 256 569 166 505C91 451 83 334 88 244C92 184 90 153 114 130Z" fill="none" stroke="#d7e0d4" stroke-width="36" stroke-dasharray="0.1 900"/>' +
        '<path d="M245 106C282 199 256 252 278 321C298 384 332 434 357 478C382 522 386 570 386 620" fill="none" stroke="#f8f4e9" stroke-width="18"/>' +
        '<path d="M565 85C557 173 572 230 592 291C612 350 610 399 603 446C597 486 596 540 604 590" fill="none" stroke="#f8f4e9" stroke-width="17"/>' +
        '<path d="M905 99C905 174 918 232 943 287C967 340 990 393 1012 446C1033 497 1043 548 1044 596" fill="none" stroke="#f8f4e9" stroke-width="16"/>' +
        '<path d="M104 352C219 348 326 330 424 343C528 357 610 384 714 400C829 418 960 442 1116 390" fill="none" stroke="#f8f4e9" stroke-width="16"/>' +
        '<path d="M278 321C365 300 454 286 565 303C648 316 705 350 714 400" fill="none" stroke="#f8f4e9" stroke-width="12"/>' +
        '<path d="M604 446C684 430 784 424 877 446" fill="none" stroke="#f8f4e9" stroke-width="10"/>' +
        '<path d="M166 505C230 460 290 438 357 478" fill="none" stroke="#f8f4e9" stroke-width="8"/>' +
        '<path d="M278 321C365 300 454 286 565 303C648 316 705 350 714 400" fill="none" stroke="#d8e1d6" stroke-width="1" stroke-dasharray="5 13"/>' +
        '<ellipse cx="961" cy="176" rx="98" ry="54" fill="#dfe8da" stroke="#cfdbce" stroke-width="1.4"/>' +
        '<ellipse cx="961" cy="176" rx="78" ry="37" fill="none" stroke="#c1d1c1" stroke-width="7" opacity=".8"/>' +
        '<path d="M905 176h112M961 142v68" stroke="#ccdac9" stroke-width="1.2" opacity=".8"/>' +
        '<path d="M705 280C735 245 797 235 844 257C890 279 911 320 883 354C850 394 772 399 728 370C690 345 674 313 705 280Z" fill="url(#waterGrad)" stroke="#9fc4c2" stroke-width="1.5"/>' +
        '<path d="M724 288C759 265 802 263 833 279" fill="none" stroke="#dcebea" stroke-width="2" stroke-linecap="round" opacity=".7"/>' +
        '<path d="M742 348C774 358 813 354 838 338" fill="none" stroke="#dcebea" stroke-width="1.4" stroke-linecap="round" opacity=".55"/>' +
        '<text x="793" y="325" text-anchor="middle" fill="#6f9997" font-size="13" font-family="Noto Serif SC, STSong, SimSun, serif" letter-spacing="4">润泽湖</text>' +
        '<g filter="url(#mapBuildingShadow)">' +
          building(146, 148, 134, 86, '敏行楼', 'MINXING') +
          building(346, 100, 118, 64, '敏知楼', 'MINZHI') +
          building(536, 176, 132, 74, '敏达楼', 'MINDA') +
          building(440, 292, 150, 92, '图书馆', 'LIBRARY') +
          building(302, 306, 104, 62, '竞慧楼', 'JINGHUI') +
          building(192, 318, 126, 66, '沁园食堂', 'CANTEEN') +
          building(474, 384, 130, 62, '润园食堂', 'CANTEEN') +
          building(786, 244, 120, 62, '泽园食堂', 'CANTEEN') +
          building(142, 402, 146, 66, '沁园宿舍', 'DORMITORY') +
          building(368, 470, 154, 68, '润园宿舍', 'DORMITORY') +
          building(758, 456, 148, 68, '泽园宿舍', 'DORMITORY') +
        '</g>' +
        '<g opacity=".72">' +
          '<path d="M452 113h84v34h-84z" fill="#f2ece0" stroke="#d9d3c5"/>' +
          '<path d="M462 121h64M462 131h48" stroke="#d8d1c1" stroke-width="2"/>' +
          '<text x="494" y="166" text-anchor="middle" fill="#a7a192" font-size="8" font-family="Microsoft YaHei, sans-serif">校史馆</text>' +
        '</g>' +
        '<g opacity=".5" fill="none" stroke="#c8d6c6">' +
          '<path d="M82 268c21-4 39 5 45 21M1112 240c-19-1-32 8-36 22M620 92c-4 14 0 24 8 32M640 520c12 4 22 2 30-4"/>' +
        '</g>' +
        trees +
        '<g transform="translate(1098 552)" opacity=".65">' +
          '<circle r="18" fill="none" stroke="#8fa493" stroke-width="1"/>' +
          '<path d="M0-13 4 5H-4Z" fill="#677d6d"/><text y="13" text-anchor="middle" fill="#7d9181" font-size="7" font-family="sans-serif">N</text>' +
        '</g>' +
        '<g transform="translate(72 570)" opacity=".55">' +
          '<path d="M0 0h64" stroke="#7d9181" stroke-width="1.2"/><path d="M0-3v6M64-3v6" stroke="#7d9181" stroke-width="1"/>' +
          '<text x="32" y="-5" text-anchor="middle" fill="#7d9181" font-size="7" font-family="Microsoft YaHei, sans-serif">约 200m</text>' +
        '</g>' +
      '</svg>'
    );
  }

  /* ------------------------------------------------------------------------
     Stations page
     ------------------------------------------------------------------------ */

  function stationsPage() {
    const zoneCards = DATA.zones.map((zone) => {
      const stations = state.stations.filter((station) => station.zone === zone.id);
      const available = stations.reduce((sum, station) => sum + station.available, 0);
      const capacity = stations.reduce((sum, station) => sum + station.capacity, 0);
      const pct = Math.round((available / Math.max(1, capacity)) * 100);
      return (
        '<div class="zone-summary" style="--zone-color:' + zone.color + ';--zone-soft:' + zone.soft + '">' +
          '<div class="zone-summary-top">' +
            '<span class="zone-summary-name">' + icon(zone.icon) + zone.name + '</span>' +
            '<span class="zone-summary-count">' + stations.length + ' 个伞点</span>' +
          '</div>' +
          '<div class="zone-summary-nums"><strong>' + available + '</strong><span>把可借</span></div>' +
          '<div class="zone-summary-bar"><i style="--pct:' + pct + '%"></i></div>' +
          '<div class="zone-summary-foot"><span>' + zone.desc + '</span><span>' + pct + '% 可用</span></div>' +
        '</div>'
      );
    }).join('');

    return (
      '<section class="page-head">' +
        '<div>' +
          '<p class="eyebrow">CAMPUS UMBRELLA NETWORK</p>' +
          '<h1>校园伞点，<em>就在你身边</em>。</h1>' +
          '<p>覆盖教学楼、宿舍与食堂三大区域。所有伞点支持校园卡 / 取伞码借还，雨天步行几分钟就能找到一把伞。</p>' +
        '</div>' +
        '<div class="page-head-actions">' +
          (isAdmin()
            ? '<button class="btn btn-primary" data-route="admin">' + icon('chart') + '进入运营看板</button>'
            : '<button class="btn btn-outline" data-action="open-return">' + icon('refresh') + '我要还伞</button>' +
              '<button class="btn btn-primary" data-action="open-borrow">' + icon('umbrella') + '借一把伞</button>') +
        '</div>' +
      '</section>' +
      '<div class="zone-summary-grid">' + zoneCards + '</div>' +
      mapCardHTML('stations') +
      '<div class="station-toolbar">' +
        '<div class="station-toolbar-left"><h2>全部伞点<span class="count-pill" id="stationCountLabel">' + filteredStationList().length + '</span></h2></div>' +
        '<div class="station-toolbar-right">' +
          '<div class="search-box">' + icon('search') + '<input type="search" placeholder="搜索伞点或区域" value="' + esc(ui.stationSearch) + '" data-station-search aria-label="搜索伞点"></div>' +
        '</div>' +
      '</div>' +
      '<div class="station-grid" id="stationGrid">' + stationCardsHTML() + '</div>'
    );
  }

  function filteredStationList() {
    const query = ui.stationSearch.trim().toLowerCase();
    return allStations().filter((station) => {
      const inZone = ui.zoneFilter === 'all' || station.zone === ui.zoneFilter;
      if (!inZone) return false;
      if (!query) return true;
      const zone = zoneOf(station.zone);
      return (station.name + station.tags.join('') + zone.name + station.note).toLowerCase().indexOf(query) > -1;
    });
  }

  function stationCardsHTML() {
    const list = filteredStationList();
    if (!list.length) {
      return '<div class="station-empty">没有找到匹配的伞点，换个关键词试试。</div>';
    }
    const loan = currentLoan();
    return list.map((station) => {
      const zone = zoneOf(station.zone);
      const stock = stockInfo(station);
      return (
        '<article class="station-card">' +
          '<div class="station-card-top">' +
            '<span class="zone-tag" style="--zone-color:' + zone.color + ';--zone-soft:' + zone.soft + '"><i></i>' + zone.name + '</span>' +
            '<span class="stock-tag ' + (stock.cls === 'low' ? 'low' : stock.cls) + '">' + stock.label + '</span>' +
          '</div>' +
          '<h3>' + esc(station.name) + '</h3>' +
          '<div class="station-distance">' + icon('navigation') + '距你 ' + station.distance + ' 米 · 步行 ' + station.walk + ' 分钟</div>' +
          '<div class="station-stock">' +
            '<div class="station-stock-num"><strong>' + station.available + '<small>把可借</small></strong><span style="color:var(--muted-light);font-size:8px">共 ' + station.capacity + ' 把</span></div>' +
            '<div class="station-bar"><i class="' + stock.cls + '" style="--pct:' + Math.round((station.available / station.capacity) * 100) + '%"></i></div>' +
          '</div>' +
          '<div class="station-meta">' + icon('clock') + station.hours + '<span>·</span>' + esc(station.note) + '</div>' +
          '<div class="station-card-foot">' +
            '<div class="station-tags">' + station.tags.map((tag) => '<span>' + esc(tag) + '</span>').join('') + '</div>' +
            (isAdmin()
              ? '<button class="text-link" data-route="admin">看库存' + icon('arrow-right') + '</button>'
              : loan
                ? '<button class="text-link" data-action="open-return">去还伞' + icon('arrow-right') + '</button>'
                : '<button class="text-link" data-action="borrow-at" data-station="' + station.id + '"' + (station.available <= 0 ? ' disabled' : '') + '>借伞' + icon('arrow-right') + '</button>') +
          '</div>' +
        '</article>'
      );
    }).join('');
  }

  function renderStationGrid() {
    const grid = $('#stationGrid');
    if (!grid) return;
    grid.innerHTML = stationCardsHTML();
    const count = $('#stationCountLabel');
    if (count) count.textContent = filteredStationList().length;
  }

  /* ------------------------------------------------------------------------
     Records page
     ------------------------------------------------------------------------ */

  function recordsPage() {
    const user = currentUser();
    const loan = currentLoan();
    const history = state.history[user.id] || [];
    const totalTrips = user.baseTrips + history.length;
    return (
      '<section class="page-head">' +
        '<div>' +
          '<p class="eyebrow">MY UMBRELLA JOURNEY</p>' +
          '<h1>我的借还，<em>清清楚楚</em>。</h1>' +
          '<p>每一次借出与归还，都记录在这段晴雨旅程里。按时归还，让信用与方便一起流动。</p>' +
        '</div>' +
        '<div class="page-head-actions">' +
          (isAdmin()
            ? '<button class="btn btn-primary" data-route="admin">' + icon('chart') + '查看运营看板</button>'
            : loan
              ? '<button class="btn btn-primary" data-action="open-return">' + icon('refresh') + '一键还伞</button>'
              : '<button class="btn btn-primary" data-action="open-borrow">' + icon('umbrella') + '去借一把伞</button>') +
        '</div>' +
      '</section>' +
      '<div class="records-grid">' +
        loanCardHTML(loan) +
        profileCardHTML(user, history) +
      '</div>' +
      '<section class="record-section">' +
        '<div class="section-head">' +
          '<div><h2>借还记录<span class="count-pill">' + history.length + '</span></h2><p>最近的校园共享雨伞使用记录</p></div>' +
          '<span class="chip">' + icon('shield') + '所有记录已同步至校园信用</span>' +
        '</div>' +
        '<div class="record-list">' + historyRowsHTML(history) + '</div>' +
      '</section>'
    );
  }

  function loanCardHTML(loan) {
    if (!loan) {
      return (
        '<section class="loan-card no-loan">' +
          '<div class="loan-head">' +
            '<div><p class="eyebrow">CURRENT UMBRELLA</p><h2>此刻，没有待归还的伞</h2><p>雨天出门前，可以先看看离你最近的伞点。</p></div>' +
            '<span class="loan-status" style="color:var(--green);background:var(--sage-soft);border-color:rgba(47,111,94,.12)"><i style="background:var(--green)"></i>无在借</span>' +
          '</div>' +
          '<div class="empty-loan-inner">' +
            '<span class="empty-umbrella">' + icon('umbrella') + '</span>' +
            (isAdmin()
              ? '<div><h3>运维账号不参与借还。</h3><p>你可以在运营看板查看全部账号的借还记录、实时库存与设备告警。</p><button class="btn btn-dark btn-sm" data-route="admin">' + icon('chart') + '进入运营看板</button></div>'
              : '<div><h3>下一场雨，也从容一点。</h3><p>从教学楼下课，或从食堂出来，校园伞网都在你步行几分钟的地方。</p><button class="btn btn-dark btn-sm" data-action="open-borrow">' + icon('pin') + '查找附近伞点</button></div>') +
          '</div>' +
        '</section>'
      );
    }
    const from = stationOf(loan.stationId);
    const due = new Date(loan.dueAt);
    const countdown = countdownParts(loan.dueAt);
    return (
      '<section class="loan-card">' +
        '<div class="loan-head">' +
          '<div><p class="eyebrow on-dark">CURRENT UMBRELLA</p><h2>一把伞，正在陪你走。</h2><p>归还至任意校园伞点即可，不必回到原借出点。</p></div>' +
          '<span class="loan-status"><i></i>借用中</span>' +
        '</div>' +
        '<div class="loan-main">' +
          '<div><div class="loan-count" data-due="' + loan.dueAt + '">' + countdown.html + '</div><div class="loan-count-label">免费借用剩余时间</div></div>' +
          '<div class="loan-route">' + icon('pin') + '<span>' + esc(from ? from.name : '校园伞点') + '</span>' + icon('arrow-right') + '<span>待归还</span></div>' +
        '</div>' +
        '<div class="loan-meta">' +
          '<span>' + icon('qr') + '取伞码 <b>' + esc(loan.code) + '</b></span>' +
          '<span>' + icon('clock') + '借于 <b>' + fmtDateTime(loan.borrowedAt) + '</b></span>' +
          '<span>' + icon('calendar') + '到期 <b>' + fmtDate(due.toISOString()) + '</b></span>' +
        '</div>' +
        '<div class="loan-actions">' +
          '<button class="btn btn-primary btn-sm" data-action="open-return">' + icon('refresh') + '立即还伞</button>' +
          '<button class="btn btn-light btn-sm" data-action="open-ticket">' + icon('qr') + '查看取伞凭证</button>' +
        '</div>' +
      '</section>'
    );
  }

  function profileCardHTML(user, history) {
    const totalTrips = user.baseTrips + history.length;
    return (
      '<section class="profile-card">' +
        '<div class="profile-top">' +
          '<span class="profile-avatar" data-tone="' + user.tone + '">' + esc(user.avatar) + '</span>' +
          '<div class="profile-info"><h2>' + esc(user.name) + '</h2><p>' + esc(user.department) + ' · ' + esc(user.detail) + '</p></div>' +
          '<button class="profile-switch" data-action="open-identity" aria-label="切换身份">' + icon('refresh') + '</button>' +
        '</div>' +
        '<div class="credit-block">' +
          '<div class="credit-ring" style="--credit:' + user.credit + '%"><strong>' + user.credit + '</strong></div>' +
          '<div class="credit-copy"><strong>校园信用分</strong><p>信用良好，借伞免押金<br>按时归还可持续积累信用</p></div>' +
        '</div>' +
        '<div class="profile-stats">' +
          '<div class="profile-stat"><strong>' + totalTrips + '</strong><span>累计借还</span></div>' +
          '<div class="profile-stat"><strong>' + user.onTimeRate + '%</strong><span>按时归还</span></div>' +
          '<div class="profile-stat"><strong>' + history.length + '</strong><span>本学期记录</span></div>' +
        '</div>' +
      '</section>'
    );
  }

  function historyRowsHTML(history) {
    if (!history.length) {
      return '<div class="record-empty">还没有借还记录。下一场雨，试试从校园伞点借一把伞吧。</div>';
    }
    return history.map((trip) => {
      const minor = trip.condition === 'minor';
      return (
        '<div class="record-row">' +
          '<span class="record-icon ' + (minor ? 'damaged' : '') + '">' + icon(minor ? 'alert' : 'umbrella') + '</span>' +
          '<div class="record-route">' +
            '<strong>' + esc(trip.from) + icon('arrow-right') + esc(trip.to) + '</strong>' +
            '<span>' + fmtDate(trip.borrowedAt) + ' · 单号 ' + esc(trip.code) + '</span>' +
          '</div>' +
          '<span class="record-duration">用时 <b>' + durationLabel(trip.duration) + '</b></span>' +
          '<span class="record-badge ' + (minor ? 'minor' : '') + '">' + (minor ? '已报修' : '已归还') + '</span>' +
          '<span class="record-credit ' + (minor ? 'damaged' : '') + '">' + (minor ? '-5 信用' : '+1 信用') + '</span>' +
        '</div>'
      );
    }).join('');
  }

  function openTicket() {
    const loan = currentLoan();
    if (!loan) {
      toast('当前没有待归还的雨伞', 'error');
      return;
    }
    const station = stationOf(loan.stationId);
    openModal(
      '<div class="modal-head">' +
        '<div><p class="eyebrow">PICK-UP PASS</p><h2>取伞凭证</h2><p>到伞点后输入取伞码，或扫描柜机二维码</p></div>' +
        '<button class="modal-close" data-action="close-modal" aria-label="关闭">' + icon('close') + '</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="success-view">' +
          '<div class="success-mark">' + icon('umbrella') + '</div>' +
          '<h3 style="margin-top:18px">你的伞正在等你</h3>' +
          '<p>' + esc(station ? station.name : '校园伞点') + ' · ' + esc(loan.slot || 'A-01') + ' 号柜格</p>' +
          '<div class="ticket">' +
            '<div class="ticket-code"><span>取伞码</span><strong>' + esc(loan.code) + '</strong></div>' +
            '<div class="ticket-grid">' +
              '<div><span>借出时间</span><strong>' + fmtDateTime(loan.borrowedAt) + '</strong></div>' +
              '<div><span>归还时限</span><strong>' + fmtDateTime(loan.dueAt) + '</strong></div>' +
              '<div><span>伞点位置</span><strong>' + esc(station ? station.name : '—') + '</strong></div>' +
              '<div><span>服务时长</span><strong>48 小时内免费</strong></div>' +
            '</div>' +
          '</div>' +
          '<p style="margin-top:12px">取伞后请轻拿轻放，让下一位同学也能遇见一把好伞。</p>' +
        '</div>' +
      '</div>' +
      '<div class="modal-foot"><span class="modal-foot-note">凭证已保存到「我的借还」</span><div class="modal-foot-actions"><button class="btn btn-dark btn-sm" data-action="close-modal">完成</button></div></div>',
      'modal-sm'
    );
  }

  /* ------------------------------------------------------------------------
     Civility page
     ------------------------------------------------------------------------ */

  function civilityPage() {
    const user = currentUser();
    const signed = state.pledges.signedBy.indexOf(user.id) > -1;
    const principles = [
      { icon: 'clock', title: '按时归还', text: '48 小时内归还至任意伞点，不让下一位在雨里多等一分钟。' },
      { icon: 'shield', title: '轻拿轻放', text: '收伞时顺着伞骨整理，不拖拽、不重压，让每一把伞都能被长久使用。' },
      { icon: 'heart', title: '主动让伞', text: '看到没带伞的同学，顺路就一起走一段。雨天的善意，比伞面更大。' },
      { icon: 'alert', title: '及时报修', text: '发现伞骨松动或伞面破损，归还时选择「需要报修」，让维修更快抵达。' }
    ];
    return (
      '<section class="civility-hero">' +
        '<div class="civility-hero-copy">' +
          '<p class="eyebrow on-dark">THE UMBRELLA PROMISE</p>' +
          '<h1>借的是伞，<br><span>还的是信任。</span></h1>' +
          '<p>南京审计大学校园共享雨伞，不只解决一场雨，也在练习一种彼此照应的校园秩序。每一次准时归还，都是留给陌生人的温柔。</p>' +
          '<div class="civility-hero-actions">' +
            '<button class="btn btn-primary" data-action="sign-pledge">' + icon(signed ? 'check' : 'heart') + (signed ? '你已签署文明公约' : '我承诺文明借还') + '</button>' +
            '<span class="pledge-count"><b>' + state.pledges.count.toLocaleString('zh-CN') + '</b> 位南审人已签署</span>' +
          '</div>' +
        '</div>' +
        '<div class="civility-art" aria-hidden="true">' +
          '<span class="big-char">信</span>' +
          '<span class="umbrella-badge">' + icon('umbrella') + '</span>' +
          '<span class="art-note">雨会停，信任不会。</span>' +
        '</div>' +
      '</section>' +
      '<div class="civility-stats">' +
        '<div class="civility-stat">' + icon('users') + '<div><strong>' + state.pledges.count.toLocaleString('zh-CN') + '</strong><span>人参与文明承诺</span></div></div>' +
        '<div class="civility-stat">' + icon('award') + '<div><strong>98.6%</strong><span>雨伞按时归还率</span></div></div>' +
        '<div class="civility-stat">' + icon('leaf') + '<div><strong>0 元</strong><span>信用借伞免押金</span></div></div>' +
      '</div>' +
      '<section style="margin-top:29px">' +
        '<div class="section-head"><div><h2>四条小小的约定</h2><p>文明不是口号，是雨天里一个顺手的动作</p></div><span class="chip">' + icon('sparkles') + '让伞回到下一个人手里</span></div>' +
        '<div class="principle-grid">' + principles.map((item, index) => (
          '<article class="principle-card">' +
            '<span class="principle-num">0' + (index + 1) + '</span>' +
            '<span class="principle-icon">' + icon(item.icon) + '</span>' +
            '<h3>' + item.title + '</h3>' +
            '<p>' + item.text + '</p>' +
          '</article>'
        )).join('') + '</div>' +
      '</section>' +
      '<section class="steps-section">' +
        '<div class="section-head"><div><h2>借伞，只需三步</h2><p>简单一点，雨天就轻一点</p></div><span class="chip">' + icon('clock') + '平均取伞 2.4 分钟</span></div>' +
        '<div class="steps-grid">' +
          civilityStep('01', '找到最近的伞点', '在「校园伞点」查看实时库存与步行距离，教学楼、宿舍、食堂均有覆盖。') +
          civilityStep('02', '扫码或输入取伞码', '校园卡信用免押金。借出后 48 小时内归还至任意伞点即可。') +
          civilityStep('03', '把伞送回伞架', '收好伞面、放回柜格。若发现损坏，记得在归还时选择「需要报修」。') +
        '</div>' +
      '</section>' +
      '<div class="story-grid">' +
        '<section class="story-card">' +
          '<div class="section-head" style="margin-bottom:0"><div><h2>雨天小问答</h2><p>那些你可能犹豫过的瞬间</p></div></div>' +
          '<div class="qa-list">' +
            qaItem('伞可以还到别的伞点吗？', '可以。校园内任意伞点都支持归还，不必回到原借出点，顺路还伞更从容。') +
            qaItem('超过 48 小时会怎样？', '系统会发送提醒并暂停再次借伞，归还后即可恢复。若遇特殊情况，可联系后勤保障处说明。') +
            qaItem('发现伞坏了怎么办？', '归还时选择「伞况需要报修」，将雨伞交给伞点即可。主动报修不会影响信用，反而会让下一位更安心。') +
            qaItem('没有校园卡可以借吗？', '可以。登录校园统一身份认证后生成取伞码，扫码即可借还。教师与学生使用同一套信用规则。') +
          '</div>' +
        '</section>' +
        '<section class="pledge-card">' +
          '<span>THE PROMISE · 2026</span>' +
          '<h2>下一次雨落，<br>也做那个把伞留下的人。</h2>' +
          '<p>你的一个准时归还，可能刚好接住另一位同学匆忙的雨天。</p>' +
          '<button class="btn ' + (signed ? 'signed' : '') + '" data-action="sign-pledge">' + icon(signed ? 'check' : 'heart') + (signed ? '已签署 · 谢谢你' : '签下我的名字') + '</button>' +
          '<span class="pledge-note">' + (signed ? '你的承诺已记录，可在切换身份后重复体验。' : '签署后，你的名字会汇入南审文明借还计划。') + '</span>' +
        '</section>' +
      '</div>'
    );
  }

  function civilityStep(num, title, text) {
    return (
      '<div class="step-item">' +
        '<span class="step-num">' + num + '</span>' +
        '<div class="step-copy"><h3>' + title + '</h3><p>' + text + '</p></div>' +
      '</div>'
    );
  }

  function qaItem(question, answer) {
    return (
      '<div class="qa-item">' +
        '<div class="qa-q">' + icon('message') + question + '</div>' +
        '<p>' + answer + '</p>' +
      '</div>'
    );
  }

  /* ------------------------------------------------------------------------
     Admin page
     ------------------------------------------------------------------------ */

  function adminPage() {
    const available = totalAvailable();
    const damaged = totalDamaged();
    const active = activeLoanCount();
    const returnRate = ((state.metrics.todayReturns / Math.max(1, state.metrics.todayBorrows)) * 100).toFixed(1);
    const alerts = state.alerts.filter((alert) => !alert.resolved);
    return (
      '<section class="admin-head">' +
        '<div>' +
          '<p class="eyebrow">OPERATIONS CENTER</p>' +
          '<h1>运营看板</h1>' +
          '<p>校园共享雨伞 · 实时库存、借还趋势与设备告警</p>' +
        '</div>' +
        '<div class="admin-head-actions">' +
          '<span class="role-pill"><i></i>后勤运维 · ' + esc(currentUser().name) + '</span>' +
          '<span class="role-pill" style="color:var(--blue);background:var(--blue-soft);border-color:rgba(75,120,145,.12)"><i style="background:var(--blue)"></i>SQLite · 实时写入</span>' +
          '<button class="btn btn-outline btn-sm" data-action="open-notifications">' + icon('bell') + '全部告警</button>' +
          '<button class="btn btn-outline btn-sm" data-action="reset-demo">' + icon('refresh') + '重置数据</button>' +
        '</div>' +
      '</section>' +
      '<div class="admin-kpis">' +
        adminKpi('今日借出', state.metrics.todayBorrows, '次', '较昨日 <b>+12.4%</b>，晚高峰将至', '') +
        adminKpi('今日归还', state.metrics.todayReturns, '次', '按时归还率 <b>' + returnRate + '%</b>', '') +
        adminKpi('当前在借', active, '把', '逾期 <b>0</b> 把 · 全部在免费期内', '') +
        adminKpi('待检修', damaged, '把', '可用库存 <b>' + available + '</b> 把 / 共 ' + totalCapacity() + ' 把', 'warn') +
      '</div>' +
      '<div class="admin-grid">' +
        chartCardHTML() +
        alertsCardHTML(alerts) +
      '</div>' +
      '<section class="stock-section">' +
        '<div class="stock-head">' +
          '<div><h2>伞点库存</h2><p>点击「补货」可模拟后勤人员补充雨伞</p></div>' +
          '<div class="stock-head-actions"><div class="search-box">' + icon('search') + '<input type="search" placeholder="搜索伞点" value="' + esc(ui.adminSearch) + '" data-admin-search aria-label="搜索库存伞点"></div></div>' +
        '</div>' +
        '<div class="stock-table-wrap">' +
          '<table class="stock-table">' +
            '<thead><tr><th>伞点</th><th>实时库存</th><th>库存状态</th><th>今日借用</th><th>待检修</th><th>操作</th></tr></thead>' +
            '<tbody id="stockTableBody">' + stockRowsHTML() + '</tbody>' +
          '</table>' +
        '</div>' +
      '</section>'
    );
  }

  function adminKpi(label, value, unit, foot, cls) {
    return (
      '<div class="admin-kpi">' +
        '<span>' + label + '</span>' +
        '<strong>' + value + '<small>' + unit + '</small></strong>' +
        '<div class="admin-kpi-foot ' + (cls || '') + '">' + foot + '</div>' +
      '</div>'
    );
  }

  function chartCardHTML() {
    return (
      '<section class="chart-card">' +
        '<div class="chart-head">' +
          '<div><h2>近七日借还趋势</h2><p>校园伞网 · 每日借出与归还次数</p></div>' +
          '<div class="chart-legend"><span><i></i>借出</span><span><i></i>归还</span></div>' +
        '</div>' +
        '<div class="chart-wrap">' + trendChartSVG() + '</div>' +
      '</section>'
    );
  }

  function trendChartSVG() {
    const trend = state.trend && state.trend.length ? state.trend : DATA.trend;
    const w = 620;
    const h = 210;
    const padL = 34;
    const padR = 14;
    const padT = 18;
    const padB = 30;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const max = Math.ceil(Math.max(120, ...trend.map((item) => Math.max(item.borrow, item.returned))) / 30) * 30;
    const step = plotW / (trend.length - 1);
    const pointsBorrow = trend.map((item, index) => ({
      x: padL + step * index,
      y: padT + (1 - item.borrow / max) * plotH,
      value: item.borrow,
      day: item.day
    }));
    const pointsReturn = trend.map((item, index) => ({
      x: padL + step * index,
      y: padT + (1 - item.returned / max) * plotH,
      value: item.returned,
      day: item.day
    }));

    function smooth(points) {
      let d = 'M' + points[0].x.toFixed(1) + ' ' + points[0].y.toFixed(1);
      for (let i = 0; i < points.length - 1; i += 1) {
        const current = points[i];
        const next = points[i + 1];
        const mid = (current.x + next.x) / 2;
        d += ' C' + mid.toFixed(1) + ' ' + current.y.toFixed(1) + ', ' + mid.toFixed(1) + ' ' + next.y.toFixed(1) + ', ' + next.x.toFixed(1) + ' ' + next.y.toFixed(1);
      }
      return d;
    }

    const lineBorrow = smooth(pointsBorrow);
    const lineReturn = smooth(pointsReturn);
    const area = lineBorrow + ' L' + pointsBorrow[pointsBorrow.length - 1].x.toFixed(1) + ' ' + (padT + plotH) + ' L' + padL + ' ' + (padT + plotH) + ' Z';
    const gridValues = [];
    for (let value = 0; value <= max; value += 30) gridValues.push(value);
    const grids = gridValues.map((value) => {
      const y = padT + (1 - value / max) * plotH;
      return (
        '<line class="chart-grid-line" x1="' + padL + '" y1="' + y + '" x2="' + (w - padR) + '" y2="' + y + '"/>' +
        '<text class="chart-axis-label" x="' + (padL - 8) + '" y="' + (y + 3) + '" text-anchor="end">' + value + '</text>'
      );
    }).join('');
    const labels = DATA.trend.map((item, index) => (
      '<text class="chart-axis-label" x="' + (padL + step * index) + '" y="' + (h - 8) + '" text-anchor="middle">' + item.day + '</text>'
    )).join('');
    const dotsBorrow = pointsBorrow.map((point) => (
      '<circle class="chart-dot" cx="' + point.x + '" cy="' + point.y + '" r="3.4"><title>' + point.day + ' 借出 ' + point.value + ' 次</title></circle>'
    )).join('');
    const dotsReturn = pointsReturn.map((point) => (
      '<circle class="chart-dot secondary" cx="' + point.x + '" cy="' + point.y + '" r="2.6"><title>' + point.day + ' 归还 ' + point.value + ' 次</title></circle>'
    )).join('');

    return (
      '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="近七日借还趋势折线图">' +
        '<defs><linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#2f6f5e" stop-opacity=".22"/><stop offset="100%" stop-color="#2f6f5e" stop-opacity="0"/>' +
        '</linearGradient></defs>' +
        grids +
        '<path class="chart-area" d="' + area + '"/>' +
        '<path class="chart-line secondary" d="' + lineReturn + '"/>' +
        '<path class="chart-line" d="' + lineBorrow + '"/>' +
        dotsReturn + dotsBorrow + labels +
      '</svg>'
    );
  }

  function alertsCardHTML(alerts) {
    const items = alerts.length ? alerts.map((alert) => (
      '<div class="alert-item">' +
        '<span class="alert-dot ' + (alert.level === 'danger' ? 'danger' : alert.level === 'info' ? 'info' : '') + '"></span>' +
        '<div class="alert-body"><strong>' + esc(alert.title) + '</strong><p>' + esc(alert.desc) + '</p><span>' + esc(alert.time) + '</span></div>' +
        '<button class="alert-action" data-action="resolve-alert" data-alert="' + alert.id + '">处理</button>' +
      '</div>'
    )).join('') : '<div class="alert-empty">全部告警已处理，伞网运行平稳。</div>';

    return (
      '<section class="alerts-card">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px"><div><h2>待处理事项</h2><p>' + alerts.length + ' 条需要关注</p></div>' +
          (alerts.length ? '<button class="text-link" data-action="resolve-all" style="font-size:8px">全部处理</button>' : '') +
        '</div>' +
        '<div class="alert-list">' + items + '</div>' +
      '</section>'
    );
  }

  function filteredAdminStations() {
    const query = ui.adminSearch.trim().toLowerCase();
    return allStations().filter((station) => {
      if (!query) return true;
      return (station.name + zoneOf(station.zone).name + station.code).toLowerCase().indexOf(query) > -1;
    });
  }

  function stockRowsHTML() {
    const list = filteredAdminStations();
    if (!list.length) {
      return '<tr><td colspan="6" style="padding:36px;text-align:center;color:var(--muted)">没有找到匹配的伞点。</td></tr>';
    }
    return list.map((station) => {
      const zone = zoneOf(station.zone);
      const stock = stockInfo(station);
      const pct = Math.round((station.available / station.capacity) * 100);
      const canRestock = station.available < station.capacity;
      return (
        '<tr>' +
          '<td><div class="table-station"><span class="table-station-icon">' + icon(zone.icon) + '</span><div><strong>' + esc(station.name) + '</strong><span>' + zone.name + ' · ' + station.code + '</span></div></div></td>' +
          '<td><div class="table-meter"><div class="table-meter-bar"><i class="' + stock.cls + '" style="--pct:' + pct + '%"></i></div><span>' + station.available + ' / ' + station.capacity + '</span></div></td>' +
          '<td><span class="table-status ' + stock.cls + '"><i></i>' + stock.label + '</span></td>' +
          '<td>' + (24 + ((station.distance + station.capacity) % 38)) + ' 次</td>' +
          '<td>' + (station.damaged || 0) + ' 把</td>' +
          '<td><button class="table-action" data-action="restock" data-station="' + station.id + '"' + (canRestock ? '' : ' disabled') + '>' + (canRestock ? '补货' : '已满') + '</button></td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderStockTable() {
    const body = $('#stockTableBody');
    if (!body) return;
    body.innerHTML = stockRowsHTML();
  }

  /* ------------------------------------------------------------------------
     Borrow flow
     ------------------------------------------------------------------------ */

  function startBorrow(preselectedId) {
    const user = currentUser();
    if (currentLoan()) {
      toast('你还有一把雨伞未归还，先让它回家吧', 'error');
      go('records');
      return;
    }
    const availableStations = allStations().filter((station) => station.available > 0);
    if (!availableStations.length) {
      toast('暂时没有可借雨伞，请稍后再试', 'error');
      return;
    }
    let stationId = preselectedId;
    if (!stationId || !stationOf(stationId) || stationOf(stationId).available <= 0) {
      stationId = availableStations[0].id;
    }
    flow = {
      mode: 'borrow',
      step: 1,
      zone: 'all',
      stationId,
      agreed: false,
      condition: 'good',
      result: null
    };
    openModal(borrowModalHTML());
  }

  function borrowModalHTML() {
    const step = flow.step;
    let body = '';
    let foot = '';
    if (step === 1) {
      body = borrowPickStepHTML();
      foot =
        '<span class="modal-foot-note">免押金 · 48 小时内免费<br>归还至任意校园伞点</span>' +
        '<div class="modal-foot-actions">' +
          '<button class="btn btn-outline btn-sm" data-action="close-modal">取消</button>' +
          '<button class="btn btn-primary btn-sm" data-action="borrow-next">下一步' + icon('arrow-right') + '</button>' +
        '</div>';
    } else if (step === 2) {
      body = borrowConfirmStepHTML();
      foot =
        '<span class="modal-foot-note">确认后雨伞将从所选伞点取出<br>请在 48 小时内归还</span>' +
        '<div class="modal-foot-actions">' +
          '<button class="btn btn-outline btn-sm" data-action="borrow-back">上一步</button>' +
          '<button class="btn btn-primary btn-sm" id="borrowConfirm" data-action="borrow-confirm"' + (flow.agreed ? '' : ' disabled') + '>确认借伞' + icon('check') + '</button>' +
        '</div>';
    } else {
      return borrowSuccessHTML();
    }

    return (
      '<div class="modal-head">' +
        '<div><p class="eyebrow">BORROW AN UMBRELLA</p><h2>借一把伞，带回一份安心</h2><p>选择离你最近的伞点，凭校园信用免押金取伞</p></div>' +
        '<button class="modal-close" data-action="close-modal" aria-label="关闭">' + icon('close') + '</button>' +
      '</div>' +
      flowStepsHTML(step) +
      '<div class="modal-body">' + body + '</div>' +
      '<div class="modal-foot">' + foot + '</div>'
    );
  }

  function flowStepsHTML(step) {
    const labels = flow.mode === 'return' ? ['选归还点', '确认归还', '归还成功'] : ['选伞点', '确认信息', '取伞成功'];
    return (
      '<div class="flow-steps" aria-label="借还进度">' +
        labels.map((label, index) => {
          const number = index + 1;
          const cls = number === step ? 'active' : number < step ? 'done' : '';
          return '<span class="flow-step ' + cls + '"><b>' + (number < step ? '✓' : number) + '</b>' + label + '</span>' +
            (index < labels.length - 1 ? '<span class="flow-line"></span>' : '');
        }).join('') +
      '</div>'
    );
  }

  function borrowPickStepHTML() {
    const stations = allStations().filter((station) => flow.zone === 'all' || station.zone === flow.zone);
    const zoneTabs = [{ id: 'all', name: '全部' }].concat(DATA.zones.map((zone) => ({ id: zone.id, name: zone.name }))).map((zone) => (
      '<button class="' + (flow.zone === zone.id ? 'active' : '') + '" data-action="flow-zone" data-zone="' + zone.id + '">' + zone.name + '</button>'
    )).join('');
    const cards = stations.map((station) => {
      const zone = zoneOf(station.zone);
      return (
        '<button class="pick-card ' + (flow.stationId === station.id ? 'selected' : '') + '" data-action="pick-station" data-station="' + station.id + '"' + (station.available <= 0 ? ' disabled' : '') + ' style="--zone-color:' + zone.color + ';--zone-soft:' + zone.soft + '">' +
          '<span class="pick-icon">' + icon(zone.icon) + '</span>' +
          '<span class="pick-main"><strong>' + esc(station.name) + '</strong><span>' + zone.name + ' · 步行 ' + station.walk + ' 分钟 · ' + station.hours + '</span></span>' +
          '<span class="pick-stock ' + (station.available <= 0 ? 'empty' : '') + '"><strong>' + station.available + '</strong><span>把可借</span></span>' +
          '<span class="pick-radio">' + icon('check') + '</span>' +
        '</button>'
      );
    }).join('');

    return (
      '<div class="pick-zone-tabs">' + zoneTabs + '</div>' +
      '<div class="station-picker">' + (cards || '<div class="alert-empty">该区域暂无可借雨伞。</div>') + '</div>' +
      '<div style="display:flex;gap:6px;align-items:flex-start;margin-top:12px;color:var(--muted);font-size:8.5px;line-height:1.6">' + icon('info') + '<span>库存每 30 秒刷新一次。到达伞点后，在柜机输入取伞码即可取伞。</span></div>'
    );
  }

  function borrowConfirmStepHTML() {
    const user = currentUser();
    const station = stationOf(flow.stationId);
    return (
      '<div class="user-strip">' +
        '<span class="avatar" data-tone="' + user.tone + '">' + esc(user.avatar) + '</span>' +
        '<div class="user-strip-meta"><strong>' + esc(user.name) + '</strong><span>' + esc(user.roleLabel) + ' · ' + esc(user.department) + ' · ' + esc(user.studentNo) + '</span></div>' +
        '<span class="credit-inline">' + icon('shield') + '信用 ' + user.credit + '</span>' +
      '</div>' +
      '<div class="summary-box">' +
        '<div class="summary-row"><span>取伞伞点</span><strong>' + esc(station.name) + '</strong></div>' +
        '<div class="summary-row"><span>距离与步行</span><strong>' + station.distance + ' 米 · 约 ' + station.walk + ' 分钟</strong></div>' +
        '<div class="summary-row"><span>免费时长</span><strong class="green">48 小时</strong></div>' +
        '<div class="summary-row"><span>借还方式</span><strong>取伞码取伞 · 任意伞点归还</strong></div>' +
        '<div class="summary-row"><span>信用保障</span><strong class="green">信用良好 · 免押金</strong></div>' +
      '</div>' +
      '<div class="rule-list">' +
        '<div class="rule-item">' + icon('check') + '<span>取伞后请检查伞面与伞骨，如有问题可在 10 分钟内更换。</span></div>' +
        '<div class="rule-item">' + icon('check') + '<span>请在 48 小时内归还，归还至任意校园伞点即可。</span></div>' +
        '<div class="rule-item">' + icon('check') + '<span>雨伞是校园公共物品，请轻拿轻放，让下一位也能安心使用。</span></div>' +
      '</div>' +
      '<label class="form-check">' +
        '<input type="checkbox" id="agreeRule"' + (flow.agreed ? ' checked' : '') + '>' +
        '<span class="check-box">' + icon('check') + '</span>' +
        '<span>我已阅读并同意《南京审计大学校园共享雨伞文明借还公约》，承诺按时归还、爱护公物。</span>' +
      '</label>'
    );
  }

  function borrowSuccessHTML() {
    const result = flow.result || {};
    const user = currentUser();
    return (
      '<div class="modal-head">' +
        '<div><p class="eyebrow">BORROW SUCCESS</p><h2>取伞成功</h2><p>雨伞已从柜格取出，请前往伞点取伞</p></div>' +
        '<button class="modal-close" data-action="close-modal" aria-label="关闭">' + icon('close') + '</button>' +
      '</div>' +
      '<div class="flow-steps">' +
        '<span class="flow-step done"><b>✓</b>选伞点</span><span class="flow-line"></span>' +
        '<span class="flow-step done"><b>✓</b>确认信息</span><span class="flow-line"></span>' +
        '<span class="flow-step active"><b>3</b>取伞成功</span>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="success-view">' +
          '<div class="success-mark">' + icon('check') + '</div>' +
          '<h3>伞已在等你，' + esc(user.name) + '。</h3>' +
          '<p>请前往 <strong style="color:var(--ink-soft)">' + esc(result.stationName || '所选伞点') + '</strong>，在柜机输入取伞码取伞。</p>' +
          '<div class="ticket">' +
            '<div class="ticket-code"><span>取伞码</span><strong>' + esc(result.code || '') + '</strong></div>' +
            '<div class="ticket-grid">' +
              '<div><span>伞点与柜格</span><strong>' + esc(result.stationName || '') + ' · ' + esc(result.slot || '') + '</strong></div>' +
              '<div><span>归还时限</span><strong>' + fmtDateTime(result.dueAt || new Date().toISOString()) + '</strong></div>' +
              '<div><span>借用人</span><strong>' + esc(user.name) + ' · ' + esc(user.roleLabel) + '</strong></div>' +
              '<div><span>费用</span><strong>0 元 · 信用免押</strong></div>' +
            '</div>' +
          '</div>' +
          '<p style="margin-top:12px">取伞后请轻拿轻放，48 小时内归还至任意伞点。</p>' +
          '<div class="success-actions">' +
            '<button class="btn btn-outline" data-action="close-modal">继续逛逛</button>' +
            '<button class="btn btn-dark" data-action="go-records">查看我的借还' + icon('arrow-right') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  async function commitBorrow() {
    if (flow.busy) return;
    if (currentLoan()) {
      toast('你还有一把雨伞未归还', 'error');
      closeModal();
      go('records');
      return;
    }
    const station = stationOf(flow.stationId);
    if (!station || station.available <= 0) {
      toast('这个伞点刚刚被借完了，换一个试试', 'error');
      flow.step = 1;
      setModalContent(borrowModalHTML());
      return;
    }
    if (!flow.agreed) {
      toast('请先阅读并同意文明借还公约', 'error');
      return;
    }
    flow.busy = true;
    const button = $('#borrowConfirm');
    if (button) button.disabled = true;
    try {
      const result = await api('/api/borrow', {
        method: 'POST',
        body: { stationId: flow.stationId }
      });
      await refreshData();
      flow.result = result.loan;
      flow.step = 3;
      renderAll();
      setModalContent(borrowSuccessHTML());
      toast('借伞成功，记录已写入数据库', 'success');
    } catch (err) {
      handleApiError(err);
      if (err.status === 409) {
        await refreshData().catch(() => {});
        flow.step = 1;
        setModalContent(borrowModalHTML());
      }
    } finally {
      flow.busy = false;
      if (button) button.disabled = false;
    }
  }

  /* ------------------------------------------------------------------------
     Return flow
     ------------------------------------------------------------------------ */

  function startReturn() {
    const loan = currentLoan();
    if (!loan) {
      toast('当前没有待归还的雨伞', 'error');
      if (ui.route !== 'records') go('records');
      return;
    }
    flow = {
      mode: 'return',
      step: 1,
      zone: 'all',
      stationId: loan.stationId,
      condition: 'good',
      agreed: true,
      result: null
    };
    openModal(returnModalHTML());
  }

  function returnModalHTML() {
    const step = flow.step;
    let body = '';
    let foot = '';
    if (step === 1) {
      body = returnPickStepHTML();
      foot =
        '<span class="modal-foot-note">支持跨伞点归还<br>归还后由伞点自动核验</span>' +
        '<div class="modal-foot-actions">' +
          '<button class="btn btn-outline btn-sm" data-action="close-modal">取消</button>' +
          '<button class="btn btn-primary btn-sm" data-action="return-next">下一步' + icon('arrow-right') + '</button>' +
        '</div>';
    } else if (step === 2) {
      body = returnConfirmStepHTML();
      foot =
        '<span class="modal-foot-note">请将雨伞放入柜格并关好柜门<br>系统将自动完成归还</span>' +
        '<div class="modal-foot-actions">' +
          '<button class="btn btn-outline btn-sm" data-action="return-back">上一步</button>' +
          '<button class="btn btn-primary btn-sm" data-action="return-confirm">确认归还' + icon('check') + '</button>' +
        '</div>';
    } else {
      return returnSuccessHTML();
    }

    return (
      '<div class="modal-head">' +
        '<div><p class="eyebrow">RETURN AN UMBRELLA</p><h2>让伞回家，也把方便留下</h2><p>选择任意校园伞点归还，无需回到原借出点</p></div>' +
        '<button class="modal-close" data-action="close-modal" aria-label="关闭">' + icon('close') + '</button>' +
      '</div>' +
      flowStepsHTML(step) +
      '<div class="modal-body">' + body + '</div>' +
      '<div class="modal-foot">' + foot + '</div>'
    );
  }

  function returnPickStepHTML() {
    const loan = currentLoan();
    const stations = allStations().filter((station) => flow.zone === 'all' || station.zone === flow.zone);
    const zoneTabs = [{ id: 'all', name: '全部' }].concat(DATA.zones.map((zone) => ({ id: zone.id, name: zone.name }))).map((zone) => (
      '<button class="' + (flow.zone === zone.id ? 'active' : '') + '" data-action="flow-zone" data-zone="' + zone.id + '">' + zone.name + '</button>'
    )).join('');
    const cards = stations.map((station) => {
      const zone = zoneOf(station.zone);
      const isOrigin = loan && loan.stationId === station.id;
      return (
        '<button class="pick-card ' + (flow.stationId === station.id ? 'selected' : '') + '" data-action="pick-station" data-station="' + station.id + '" style="--zone-color:' + zone.color + ';--zone-soft:' + zone.soft + '">' +
          '<span class="pick-icon">' + icon(zone.icon) + '</span>' +
          '<span class="pick-main"><strong>' + esc(station.name) + (isOrigin ? ' · 原借出点' : '') + '</strong><span>' + zone.name + ' · 步行 ' + station.walk + ' 分钟 · ' + station.hours + '</span></span>' +
          '<span class="pick-stock"><strong>' + station.available + '</strong><span>把可借</span></span>' +
          '<span class="pick-radio">' + icon('check') + '</span>' +
        '</button>'
      );
    }).join('');

    return (
      '<div class="user-strip" style="background:rgba(230,173,85,.08);border-color:rgba(230,173,85,.16)">' +
        '<span class="pick-icon" style="background:var(--amber-soft);color:var(--amber-deep);width:34px;height:34px">' + icon('umbrella') + '</span>' +
        '<div class="user-strip-meta"><strong>当前待归还 · ' + esc(loan ? loan.code : '') + '</strong><span>借于 ' + (loan ? fmtDateTime(loan.borrowedAt) : '—') + ' · 免费期内</span></div>' +
        '<span class="credit-inline" style="color:var(--amber-deep)">' + icon('clock') + '48h</span>' +
      '</div>' +
      '<div class="pick-zone-tabs">' + zoneTabs + '</div>' +
      '<div class="station-picker">' + cards + '</div>' +
      '<div style="display:flex;gap:6px;align-items:flex-start;margin-top:12px;color:var(--muted);font-size:8.5px;line-height:1.6">' + icon('info') + '<span>推荐选择你顺路经过的伞点。若伞点库存已满，可将雨伞交给现场工作人员。</span></div>'
    );
  }

  function returnConfirmStepHTML() {
    const loan = currentLoan();
    const from = loan ? stationOf(loan.stationId) : null;
    const to = stationOf(flow.stationId);
    const used = loan ? Math.max(1, Math.round((Date.now() - new Date(loan.borrowedAt).getTime()) / 60000)) : 0;
    return (
      '<div class="summary-box">' +
        '<div class="summary-row"><span>借出伞点</span><strong>' + esc(from ? from.name : '—') + '</strong></div>' +
        '<div class="summary-row"><span>归还伞点</span><strong>' + esc(to ? to.name : '—') + '</strong></div>' +
        '<div class="summary-row"><span>本次使用</span><strong>' + durationLabel(used) + '</strong></div>' +
        '<div class="summary-row"><span>取伞码</span><strong>' + esc(loan ? loan.code : '—') + '</strong></div>' +
        '<div class="summary-row"><span>费用</span><strong class="green">0 元 · 免费期内</strong></div>' +
      '</div>' +
      '<div style="margin-top:15px"><span class="eyebrow" style="font-size:8.5px">UMBRELLA CONDITION</span><p style="margin-top:5px;color:var(--muted);font-size:9px">请选择雨伞当前状态，帮助我们及时维护。</p></div>' +
      '<div class="condition-options">' +
        '<button class="condition-option ' + (flow.condition === 'good' ? 'selected' : '') + '" data-action="set-condition" data-condition="good">' +
          icon('check') + '<span><strong>伞况良好</strong><span>伞面、伞骨完整，可以继续使用</span></span>' +
        '</button>' +
        '<button class="condition-option ' + (flow.condition === 'damaged' ? 'selected' : '') + '" data-action="set-condition" data-condition="damaged">' +
          icon('alert') + '<span><strong>需要报修</strong><span>伞骨或伞面有损坏，申请检修</span></span>' +
        '</button>' +
      '</div>' +
      '<div class="rule-list">' +
        '<div class="rule-item">' + icon('check') + '<span>请确认雨伞已放入柜格并关好柜门，避免雨伞被夹住。</span></div>' +
        '<div class="rule-item">' + icon('shield') + '<span>伞况良好将获得 +1 信用；主动报修不会受到额外处罚。</span></div>' +
      '</div>'
    );
  }

  function returnSuccessHTML() {
    const result = flow.result || {};
    const damaged = result.damaged;
    return (
      '<div class="modal-head">' +
        '<div><p class="eyebrow">RETURN SUCCESS</p><h2>' + (damaged ? '雨伞已归还，报修已登记' : '还伞成功，谢谢你的准时') + '</h2><p>' + (damaged ? '维修师傅会尽快处理这把伞' : '这把伞会回到下一位需要它的人手里') + '</p></div>' +
        '<button class="modal-close" data-action="close-modal" aria-label="关闭">' + icon('close') + '</button>' +
      '</div>' +
      '<div class="flow-steps">' +
        '<span class="flow-step done"><b>✓</b>选归还点</span><span class="flow-line"></span>' +
        '<span class="flow-step done"><b>✓</b>确认归还</span><span class="flow-line"></span>' +
        '<span class="flow-step active"><b>3</b>归还成功</span>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div class="success-view">' +
          '<div class="success-mark" style="' + (damaged ? 'background:var(--clay);box-shadow:0 0 0 8px var(--clay-soft)' : '') + '">' + icon(damaged ? 'alert' : 'check') + '</div>' +
          '<h3>' + (damaged ? '谢谢你诚实地告诉我们。' : '让伞回家，也把温柔留下。') + '</h3>' +
          '<p>' + (damaged ? '维修单已同步至后勤保障处，本次主动报修不会产生额外处罚。' : '雨天的这次相遇已完成，期待下一次需要时再为你撑伞。') + '</p>' +
          '<div class="ticket">' +
            '<div class="ticket-code"><span>归还单号</span><strong>' + esc(result.code || '') + '</strong></div>' +
            '<div class="ticket-grid">' +
              '<div><span>归还伞点</span><strong>' + esc(result.to || '') + '</strong></div>' +
              '<div><span>本次使用</span><strong>' + durationLabel(result.duration || 0) + '</strong></div>' +
              '<div><span>雨伞状态</span><strong>' + (damaged ? '已报修' : '伞况良好') + '</strong></div>' +
              '<div><span>信用变化</span><strong style="color:' + (damaged ? 'var(--clay)' : 'var(--green)') + '">' + (damaged ? '-5 信用分' : '+1 信用分') + '</strong></div>' +
            '</div>' +
          '</div>' +
          '<p style="margin-top:12px">' + (damaged ? '每一把被认真对待的伞，都能陪更多人走过雨天。' : '文明借还，让方便在校园里继续流动。') + '</p>' +
          '<div class="success-actions">' +
            '<button class="btn btn-outline" data-action="close-modal">完成</button>' +
            '<button class="btn btn-dark" data-action="go-records">查看借还记录' + icon('arrow-right') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  async function commitReturn() {
    if (flow.busy) return;
    const loan = currentLoan();
    if (!loan) {
      toast('当前没有待归还的雨伞', 'error');
      closeModal();
      return;
    }
    const to = stationOf(flow.stationId);
    if (!to) {
      toast('请选择归还伞点', 'error');
      return;
    }
    flow.busy = true;
    const button = $('[data-action="return-confirm"]');
    if (button) button.disabled = true;
    try {
      const result = await api('/api/return', {
        method: 'POST',
        body: { stationId: flow.stationId, condition: flow.condition }
      });
      await refreshData();
      flow.result = result.trip;
      flow.result.damaged = result.trip.condition === 'minor';
      flow.step = 3;
      renderAll();
      setModalContent(returnSuccessHTML());
      toast(result.trip.condition === 'minor' ? '归还成功，报修已登记' : '归还成功，信用 +1', 'success');
    } catch (err) {
      handleApiError(err);
      if (err.status === 409) {
        await refreshData().catch(() => {});
        closeModal();
        go('records');
      }
    } finally {
      flow.busy = false;
      if (button) button.disabled = false;
    }
  }

  /* ------------------------------------------------------------------------
     Actions
     ------------------------------------------------------------------------ */

  async function handleAction(action, el, event) {
    if (action === 'modal-backdrop' && event.target !== el) return;
    try {
      switch (action) {
      case 'open-nav':
        openMobileNav();
        break;
      case 'close-nav':
        closeMobileNav();
        break;
      case 'close-modal':
        closeModal();
        break;
      case 'modal-backdrop':
        closeModal();
        break;
      case 'open-borrow':
        if (isAdmin()) {
          go('admin');
          break;
        }
        if (currentLoan()) {
          toast('你还有一把雨伞未归还', 'error');
          go('records');
        } else {
          startBorrow();
        }
        break;
      case 'borrow-at':
        if (isAdmin()) {
          go('admin');
          break;
        }
        if (currentLoan()) {
          toast('先归还当前雨伞，再借新的吧', 'error');
          go('records');
        } else {
          startBorrow(el.dataset.station);
        }
        break;
      case 'open-return':
        startReturn();
        break;
      case 'select-station':
        selectStation(el.dataset.station);
        break;
      case 'close-spot':
        closeSpot();
        break;
      case 'filter-zone':
        ui.zoneFilter = el.dataset.zone || 'all';
        ui.selectedStationId = null;
        renderPage();
        break;
      case 'zoom-map': {
        const step = el.dataset.step;
        if (step === 'reset') {
          ui.zoom = 1;
          toast('地图已复位');
        } else {
          ui.zoom = Math.max(0.9, Math.min(1.45, ui.zoom + Number(step)));
        }
        const stage = $('#mapStage');
        if (stage) stage.style.transform = 'scale(' + ui.zoom + ')';
        break;
      }
      case 'open-identity':
        openIdentity(null);
        break;
      case 'switch-account':
        await switchAccount(el.dataset.user);
        break;
      case 'quick-login':
        await quickLogin(el.dataset.user);
        break;
      case 'logout':
        await logout();
        break;
      case 'open-notifications':
        openNotifications();
        break;
      case 'sign-pledge': {
        const user = currentUser();
        if (state.pledges.signedBy.indexOf(user.id) > -1) {
          toast('你已经签署过文明公约啦，谢谢你', 'success');
          break;
        }
        const result = await api('/api/pledge', { method: 'POST' });
        state.pledges.count = result.pledge.count;
        state.pledges.signedBy = [user.id];
        renderPage();
        toast('承诺已写入数据库，愿你每一次借还都被温柔以待', 'success');
        break;
      }
      case 'restock': {
        const station = stationOf(el.dataset.station);
        if (!station) break;
        const result = await api('/api/restock', {
          method: 'POST',
          body: { stationId: station.id }
        });
        await refreshData();
        renderPage();
        toast('已向 ' + station.name + ' 补充 ' + result.amount + ' 把雨伞', 'success');
        break;
      }
      case 'resolve-alert': {
        await api('/api/alerts/' + encodeURIComponent(el.dataset.alert) + '/resolve', { method: 'POST' });
        await refreshData();
        renderPage();
        toast('该事项已标记为处理完成', 'success');
        break;
      }
      case 'resolve-all':
        await api('/api/alerts/resolve-all', { method: 'POST' });
        await refreshData();
        renderPage();
        toast('所有待处理事项已处理', 'success');
        break;
      case 'open-ticket':
        openTicket();
        break;
      case 'go-records':
        closeModal();
        go('records');
        break;
      case 'borrow-next': {
        const station = stationOf(flow.stationId);
        if (!station || station.available <= 0) {
          toast('请选择一个有可借库存的伞点', 'error');
          break;
        }
        flow.step = 2;
        setModalContent(borrowModalHTML());
        break;
      }
      case 'borrow-back':
        flow.step = 1;
        setModalContent(borrowModalHTML());
        break;
      case 'pick-station': {
        const station = stationOf(el.dataset.station);
        if (!station) break;
        flow.stationId = station.id;
        setModalContent(flow.mode === 'borrow' ? borrowModalHTML() : returnModalHTML());
        break;
      }
      case 'flow-zone': {
        flow.zone = el.dataset.zone || 'all';
        const list = allStations().filter((station) => flow.zone === 'all' || station.zone === flow.zone);
        if (!list.some((station) => station.id === flow.stationId)) {
          const firstAvailable = list.find((station) => flow.mode === 'return' || station.available > 0) || list[0];
          flow.stationId = firstAvailable ? firstAvailable.id : null;
        }
        setModalContent(flow.mode === 'borrow' ? borrowModalHTML() : returnModalHTML());
        break;
      }
      case 'borrow-confirm':
        commitBorrow();
        break;
      case 'return-next':
        if (!flow.stationId) {
          toast('请先选择归还伞点', 'error');
          break;
        }
        flow.step = 2;
        setModalContent(returnModalHTML());
        break;
      case 'return-back':
        flow.step = 1;
        setModalContent(returnModalHTML());
        break;
      case 'set-condition':
        flow.condition = el.dataset.condition || 'good';
        setModalContent(returnModalHTML());
        break;
      case 'return-confirm':
        commitReturn();
        break;
      case 'reset-demo':
        openResetModal();
        break;
      case 'confirm-reset':
        await resetDemo();
        break;
      default:
        break;
      }
    } catch (err) {
      handleApiError(err);
    }
  }

  function openResetModal() {
    openModal(
      '<div class="modal-head">' +
        '<div><p class="eyebrow">RESET DATABASE</p><h2>重置演示数据？</h2><p>所有账号的借还记录、库存、告警和承诺将恢复初始值</p></div>' +
        '<button class="modal-close" data-action="close-modal" aria-label="关闭">' + icon('close') + '</button>' +
      '</div>' +
      '<div class="modal-body"><div class="identity-note" style="margin-top:0">' + icon('alert') + '<span>此操作会清空 SQLite 数据库中的演示业务数据并重新写入初始数据，其他账号需要重新登录。真实校园数据不会受到影响。</span></div></div>' +
      '<div class="modal-foot"><span class="modal-foot-note">重置后仍以当前运维账号登录</span><div class="modal-foot-actions"><button class="btn btn-outline btn-sm" data-action="close-modal">取消</button><button class="btn btn-dark btn-sm" data-action="confirm-reset">确认重置</button></div></div>',
      'modal-sm'
    );
  }

  async function resetDemo() {
    if (ui.busy) return;
    ui.busy = true;
    try {
      await api('/api/admin/reset', { method: 'POST' });
      await refreshData();
      closeModal();
      ui.route = 'admin';
      try {
        history.replaceState(null, '', '#/admin');
      } catch (err) {
        /* ignore */
      }
      renderAll();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast('数据库已重置，其他账号的登录会话已失效', 'success');
    } catch (err) {
      handleApiError(err);
    } finally {
      ui.busy = false;
    }
  }

  /* ------------------------------------------------------------------------
     Events
     ------------------------------------------------------------------------ */

  document.addEventListener('click', (event) => {
    const routeEl = event.target.closest('[data-route]');
    if (routeEl) {
      event.preventDefault();
      go(routeEl.dataset.route);
      return;
    }
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    if (actionEl.tagName === 'BUTTON' && actionEl.disabled) return;
    handleAction(actionEl.dataset.action, actionEl, event);
  });

  document.addEventListener('submit', async (event) => {
    if (event.target.id !== 'loginForm') return;
    event.preventDefault();
    const form = new FormData(event.target);
    await submitLogin(String(form.get('username') || '').trim(), String(form.get('password') || ''));
  });

  document.addEventListener('input', (event) => {
    if (event.target.matches('[data-station-search]')) {
      ui.stationSearch = event.target.value;
      renderStationGrid();
    }
    if (event.target.matches('[data-admin-search]')) {
      ui.adminSearch = event.target.value;
      renderStockTable();
    }
  });

  document.addEventListener('change', (event) => {
    if (event.target.id === 'agreeRule' && flow) {
      flow.agreed = event.target.checked;
      const button = $('#borrowConfirm');
      if (button) button.disabled = !flow.agreed;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (modalRoot.innerHTML) {
        closeModal();
      } else if (document.body.classList.contains('nav-open')) {
        closeMobileNav();
      }
    }
  });

  window.addEventListener('hashchange', handleHashChange);

  window.setInterval(() => {
    $$('[data-due]').forEach((node) => {
      const parts = countdownParts(node.dataset.due);
      node.innerHTML = parts.html;
    });
  }, 30000);

  /* ------------------------------------------------------------------------
     Init
     ------------------------------------------------------------------------ */

  async function init() {
    try {
      await enterApp({ initial: true });
      window.setTimeout(animateNumbers, 120);
    } catch (err) {
      if (err.status === 401) {
        await showLogin();
      } else {
        await showLogin('无法连接数据库服务，请通过 http://127.0.0.1:8787 打开本系统。');
      }
    }
  }

  init();
})();
