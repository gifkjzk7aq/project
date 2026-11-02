/* 南审晴雨 · 校园共享雨伞
 * 数据库版后端：Node.js + SQLite，内置静态文件服务。
 *
 * 启动：node server.js
 * 默认地址：http://127.0.0.1:8787
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const DATA = require('./assets/js/data.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const DB_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DB_DIR, 'nau.db');
const DEMO_PASSWORD = 'nau123456';
const SESSION_COOKIE = 'nau_session';
const SESSION_DAYS = 7;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

fs.mkdirSync(DB_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    student_no TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
    department TEXT NOT NULL,
    detail TEXT NOT NULL,
    credit INTEGER NOT NULL DEFAULT 100,
    base_trips INTEGER NOT NULL DEFAULT 0,
    on_time_rate INTEGER NOT NULL DEFAULT 100,
    avatar TEXT NOT NULL,
    tone TEXT NOT NULL DEFAULT 'sage',
    is_demo INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    short TEXT NOT NULL,
    zone TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    available INTEGER NOT NULL,
    capacity INTEGER NOT NULL,
    damaged INTEGER NOT NULL DEFAULT 0,
    distance INTEGER NOT NULL,
    walk INTEGER NOT NULL,
    hours TEXT NOT NULL,
    code TEXT NOT NULL,
    note TEXT NOT NULL,
    tags TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    from_station_id TEXT NOT NULL,
    to_station_id TEXT,
    borrowed_at TEXT NOT NULL,
    due_at TEXT NOT NULL,
    returned_at TEXT,
    duration_min INTEGER,
    condition TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'returned')),
    slot TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_loan
    ON loans(user_id) WHERE status = 'active';
  CREATE INDEX IF NOT EXISTS idx_loans_user ON loans(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_loans_dates ON loans(borrowed_at, returned_at);

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    actor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    station TEXT NOT NULL,
    detail TEXT NOT NULL,
    tone TEXT NOT NULL DEFAULT 'sage',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    station_id TEXT,
    resolved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pledges (
    user_id TEXT PRIMARY KEY,
    signed_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_stats (
    day TEXT PRIMARY KEY,
    borrows INTEGER NOT NULL DEFAULT 0,
    returns INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
`);

/* --------------------------------------------------------------------------
   Utilities
   -------------------------------------------------------------------------- */

function pad(value) {
  return String(value).padStart(2, '0');
}

function isoNow() {
  return new Date().toISOString();
}

function localDayKey(date) {
  const d = date || new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, useSalt, 64).toString('hex');
  return useSalt + ':' + hash;
}

function verifyPassword(password, stored) {
  if (!stored || stored.indexOf(':') < 0) return false;
  const parts = stored.split(':');
  const candidate = crypto.scryptSync(password, parts[0], 64).toString('hex');
  const expected = Buffer.from(parts[1], 'hex');
  const actual = Buffer.from(candidate, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function parseCookies(header) {
  const result = {};
  if (!header) return result;
  header.split(';').forEach((chunk) => {
    const index = chunk.indexOf('=');
    if (index < 0) return;
    const key = chunk.slice(0, index).trim();
    const value = chunk.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  });
  return result;
}

function formatRelative(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return minutes + ' 分钟前';
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + ' 小时前';
  const date = new Date(iso);
  return (date.getMonth() + 1) + '月' + date.getDate() + '日';
}

function formatUser(row) {
  return {
    id: row.id,
    username: row.student_no,
    studentNo: row.student_no,
    name: row.name,
    role: row.role,
    roleLabel: row.role === 'teacher' ? '教师' : row.role === 'admin' ? '运维' : '学生',
    department: row.department,
    detail: row.detail,
    credit: row.credit,
    baseTrips: row.base_trips,
    onTimeRate: row.on_time_rate,
    avatar: row.avatar,
    tone: row.tone,
    isDemo: !!row.is_demo
  };
}

function formatStation(row) {
  let tags = [];
  try {
    tags = JSON.parse(row.tags);
  } catch (err) {
    tags = [];
  }
  return {
    id: row.id,
    name: row.name,
    short: row.short,
    zone: row.zone,
    x: row.x,
    y: row.y,
    available: row.available,
    capacity: row.capacity,
    damaged: row.damaged,
    distance: row.distance,
    walk: row.walk,
    hours: row.hours,
    code: row.code,
    note: row.note,
    tags
  };
}

function formatAlert(row) {
  return {
    id: row.id,
    level: row.level,
    title: row.title,
    desc: row.description,
    stationId: row.station_id,
    time: formatRelative(row.created_at),
    resolved: !!row.resolved
  };
}

function formatActivity(row) {
  return {
    id: String(row.id),
    name: row.actor_name,
    action: row.action,
    station: row.station,
    detail: row.detail,
    time: formatRelative(row.created_at),
    tone: row.tone
  };
}

function demoAccounts() {
  return db.prepare(`
    SELECT id, student_no, name, role, department, detail, avatar, tone
    FROM users
    WHERE is_demo = 1
    ORDER BY CASE role WHEN 'student' THEN 1 WHEN 'teacher' THEN 2 ELSE 3 END, name
  `).all().map((row) => ({
    id: row.id,
    username: row.student_no,
    name: row.name,
    role: row.role,
    roleLabel: row.role === 'teacher' ? '教师' : row.role === 'admin' ? '运维' : '学生',
    department: row.department,
    detail: row.detail,
    avatar: row.avatar,
    tone: row.tone
  }));
}

function setting(key, fallback) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function ensureToday() {
  const day = localDayKey();
  const row = db.prepare('SELECT day FROM daily_stats WHERE day = ?').get(day);
  if (!row) {
    db.prepare('INSERT INTO daily_stats (day, borrows, returns) VALUES (?, 0, 0)').run(day);
  }
  return day;
}

function bumpDaily(kind) {
  const day = ensureToday();
  if (kind === 'borrow') {
    db.prepare('UPDATE daily_stats SET borrows = borrows + 1 WHERE day = ?').run(day);
  } else {
    db.prepare('UPDATE daily_stats SET returns = returns + 1 WHERE day = ?').run(day);
  }
}

function insertActivity(user, action, station, detail) {
  db.prepare(`
    INSERT INTO activities (user_id, actor_name, action, station, detail, tone, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(user ? user.id : null, user ? user.name : '系统', action, station, detail, user ? user.tone : 'clay', isoNow());
}

function getPledgeState(userId) {
  const base = Number(setting('pledge_base', DATA.pledgeSeed.count));
  const row = db.prepare('SELECT COUNT(*) AS c FROM pledges').get();
  const signed = db.prepare('SELECT 1 AS ok FROM pledges WHERE user_id = ?').get(userId);
  return { count: base + Number(row.c), signed: !!signed };
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.token, s.expires_at, u.*
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { token, user: row };
}

function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, expires.toISOString());
  return { token, expires };
}

function cookieHeader(token, expires) {
  return SESSION_COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' +
    Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1000));
}

function clearCookieHeader() {
  return SESSION_COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function sendJson(res, status, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }, extraHeaders || {});
  res.writeHead(status, headers);
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(Object.assign(new Error('请求内容过大'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(Object.assign(new Error('请求格式错误'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function requireAuth(req) {
  const session = getSession(req);
  if (!session) throw fail(401, '请先登录');
  return session;
}

function requireAdmin(req) {
  const session = requireAuth(req);
  if (session.user.role !== 'admin') throw fail(403, '仅后勤运维可进行此操作');
  return session;
}

function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (e) { /* ignore */ }
    throw err;
  }
}

/* --------------------------------------------------------------------------
   Seed
   -------------------------------------------------------------------------- */

function seedDatabase() {
    const insertStation = db.prepare(`
      INSERT INTO stations
      (id, name, short, zone, x, y, available, capacity, damaged, distance, walk, hours, code, note, tags, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    DATA.stationSeed.forEach((station, index) => {
      insertStation.run(
        station.id, station.name, station.short, station.zone, station.x, station.y,
        station.available, station.capacity, station.damaged || 0, station.distance,
        station.walk, station.hours, station.code, station.note, JSON.stringify(station.tags), index
      );
    });

    const insertUser = db.prepare(`
      INSERT INTO users
      (id, student_no, password_hash, name, role, department, detail, credit, base_trips, on_time_rate, avatar, tone, is_demo, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
    Object.values(DATA.usersSeed).forEach((user) => {
      insertUser.run(
        user.id, user.studentNo, hashPassword(DEMO_PASSWORD), user.name, user.role,
        user.department, user.detail, user.credit, user.baseTrips, user.onTimeRate,
        user.avatar, user.tone, isoNow()
      );
    });

    const stationByName = new Map(DATA.stationSeed.map((station) => [station.name, station.id]));
    const insertLoan = db.prepare(`
      INSERT OR IGNORE INTO loans
      (code, user_id, from_station_id, to_station_id, borrowed_at, due_at, returned_at, duration_min, condition, status, slot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'returned', ?)
    `);
    Object.keys(DATA.historySeed).forEach((userId) => {
      (DATA.historySeed[userId] || []).forEach((trip, index) => {
        const fromId = stationByName.get(trip.from);
        const toId = stationByName.get(trip.to);
        if (!fromId || !toId) return;
        const due = new Date(new Date(trip.borrowedAt).getTime() + 48 * 60 * 60 * 1000).toISOString();
        insertLoan.run(
          trip.code, userId, fromId, toId, trip.borrowedAt, due, trip.returnedAt,
          trip.duration, trip.condition, 'A-' + pad(((index * 7) % 20) + 1)
        );
      });
    });

    const insertActivity = db.prepare(`
      INSERT INTO activities (actor_name, action, station, detail, tone, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const activityOffsets = [2, 6, 12, 28];
    DATA.activitiesSeed.forEach((activity, index) => {
      insertActivity.run(
        activity.name, activity.action, activity.station, activity.detail, activity.tone,
        new Date(Date.now() - (activityOffsets[index] || 30) * 60000).toISOString()
      );
    });

    const insertAlert = db.prepare(`
      INSERT INTO alerts (id, level, title, description, station_id, resolved, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `);
    const alertOffsets = [10, 32, 60];
    DATA.alertsSeed.forEach((alert, index) => {
      insertAlert.run(
        alert.id, alert.level, alert.title, alert.desc, alert.stationId,
        new Date(Date.now() - (alertOffsets[index] || 60) * 60000).toISOString()
      );
    });

    const insertStats = db.prepare('INSERT INTO daily_stats (day, borrows, returns) VALUES (?, ?, ?)');
    DATA.trend.forEach((item, index) => {
      const date = daysAgo(6 - index);
      insertStats.run(localDayKey(date), item.borrow, item.returned);
    });

    const insertSetting = db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)');
    insertSetting.run('pledge_base', String(DATA.pledgeSeed.count));
    insertSetting.run('avg_pickup', '2.4');
    insertSetting.run('seeded_at', isoNow());
}

const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (!Number(userCount)) {
  transaction(seedDatabase);
  console.log('数据库已初始化：' + DB_PATH);
}
ensureToday();

/* --------------------------------------------------------------------------
   API
   -------------------------------------------------------------------------- */

function getPublicConfig() {
  return {
    accounts: demoAccounts(),
    demoPassword: DEMO_PASSWORD,
    database: { engine: 'SQLite', file: 'data/nau.db' }
  };
}

function buildBootstrap(user) {
  const stations = db.prepare('SELECT * FROM stations ORDER BY sort_order').all().map(formatStation);
  const loanRow = db.prepare(`
    SELECT l.*, s.name AS station_name
    FROM loans l LEFT JOIN stations s ON s.id = l.from_station_id
    WHERE l.user_id = ? AND l.status = 'active'
    LIMIT 1
  `).get(user.id);
  const historyRows = db.prepare(`
    SELECT l.*, f.name AS from_name, t.name AS to_name
    FROM loans l
    JOIN stations f ON f.id = l.from_station_id
    LEFT JOIN stations t ON t.id = l.to_station_id
    WHERE l.user_id = ? AND l.status = 'returned'
    ORDER BY l.returned_at DESC
    LIMIT 50
  `).all(user.id);
  const activityRows = db.prepare('SELECT * FROM activities ORDER BY created_at DESC LIMIT 8').all();
  const alertRows = db.prepare('SELECT * FROM alerts WHERE resolved = 0 ORDER BY created_at DESC').all();
  const today = ensureToday();
  const todayRow = db.prepare('SELECT * FROM daily_stats WHERE day = ?').get(today) || { borrows: 0, returns: 0 };
  const activeCount = db.prepare("SELECT COUNT(*) AS c FROM loans WHERE status = 'active'").get().c;
  const damaged = db.prepare('SELECT COALESCE(SUM(damaged), 0) AS c FROM stations').get().c;
  const pledge = getPledgeState(user.id);

  const trend = [];
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  for (let i = 6; i >= 0; i -= 1) {
    const date = daysAgo(i);
    const day = localDayKey(date);
    const row = db.prepare('SELECT * FROM daily_stats WHERE day = ?').get(day);
    trend.push({
      day: i === 0 ? '今天' : weekdays[date.getDay()],
      date: day,
      borrow: row ? row.borrows : 0,
      returned: row ? row.returns : 0,
      rain: i === 0 ? '中雨' : ''
    });
  }

  return {
    user: formatUser(user),
    stations,
    loan: loanRow ? {
      id: loanRow.id,
      code: loanRow.code,
      slot: loanRow.slot,
      stationId: loanRow.from_station_id,
      stationName: loanRow.station_name,
      borrowedAt: loanRow.borrowed_at,
      dueAt: loanRow.due_at
    } : null,
    history: historyRows.map((row) => ({
      id: row.id,
      code: row.code,
      from: row.from_name,
      to: row.to_name,
      borrowedAt: row.borrowed_at,
      returnedAt: row.returned_at,
      duration: row.duration_min,
      condition: row.condition,
      status: row.status
    })),
    activities: activityRows.map(formatActivity),
    alerts: alertRows.map(formatAlert),
    metrics: {
      todayBorrows: todayRow.borrows,
      todayReturns: todayRow.returns,
      avgPickup: Number(setting('avg_pickup', '2.4')),
      activeLoans: Number(activeCount),
      damaged: Number(damaged)
    },
    pledge,
    trend,
    demoAccounts: demoAccounts(),
    database: { engine: 'SQLite', file: 'data/nau.db', userCount: Object.keys(DATA.usersSeed).length },
    weather: DATA.weather
  };
}

async function handleLogin(req, res) {
  const body = await readJson(req);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) throw fail(400, '请输入学号 / 工号和密码');
  const row = db.prepare('SELECT * FROM users WHERE student_no = ?').get(username);
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw fail(401, '账号或密码不正确');
  }
  const session = createSession(row.id);
  sendJson(res, 200, { ok: true, user: formatUser(row) }, {
    'Set-Cookie': cookieHeader(session.token, session.expires)
  });
}

async function handleDemoLogin(req, res) {
  const body = await readJson(req);
  const row = db.prepare('SELECT * FROM users WHERE id = ? AND is_demo = 1').get(String(body.userId || ''));
  if (!row) throw fail(404, '演示账号不存在');
  const session = createSession(row.id);
  sendJson(res, 200, { ok: true, user: formatUser(row) }, {
    'Set-Cookie': cookieHeader(session.token, session.expires)
  });
}

function handleLogout(req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookieHeader() });
}

async function handleBorrow(req, res) {
  const session = requireAuth(req);
  const user = session.user;
  if (user.role === 'admin') throw fail(403, '运维账号不参与借伞');
  const body = await readJson(req);
  const stationId = String(body.stationId || '');
  const result = transaction(() => {
    const active = db.prepare("SELECT id FROM loans WHERE user_id = ? AND status = 'active'").get(user.id);
    if (active) throw fail(409, '你还有一把雨伞未归还');
    const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(stationId);
    if (!station) throw fail(404, '伞点不存在');
    if (station.available <= 0) throw fail(409, '这个伞点暂时没有可借雨伞');
    db.prepare('UPDATE stations SET available = available - 1 WHERE id = ? AND available > 0').run(stationId);
    const now = new Date();
    const due = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    let code = '';
    for (let i = 0; i < 12; i += 1) {
      const candidate = 'NY' + String(now.getFullYear()).slice(2) + '-' + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + Math.floor(100 + Math.random() * 900);
      const exists = db.prepare('SELECT id FROM loans WHERE code = ?').get(candidate);
      if (!exists) { code = candidate; break; }
    }
    if (!code) throw fail(500, '取伞码生成失败，请重试');
    const slot = 'A-' + pad(Math.floor(1 + Math.random() * 24));
    db.prepare(`
      INSERT INTO loans (code, user_id, from_station_id, borrowed_at, due_at, status, slot)
      VALUES (?, ?, ?, ?, ?, 'active', ?)
    `).run(code, user.id, stationId, now.toISOString(), due.toISOString(), slot);
    insertActivity(user, '借出雨伞', station.name, '信用分 ' + user.credit);
    bumpDaily('borrow');
    return {
      code, slot, stationName: station.name, stationId,
      borrowedAt: now.toISOString(), dueAt: due.toISOString()
    };
  });
  sendJson(res, 200, { ok: true, loan: result });
}

async function handleReturn(req, res) {
  const session = requireAuth(req);
  const user = session.user;
  if (user.role === 'admin') throw fail(403, '运维账号不参与还伞');
  const body = await readJson(req);
  const stationId = String(body.stationId || '');
  const condition = body.condition === 'damaged' ? 'damaged' : 'good';
  const result = transaction(() => {
    const loan = db.prepare(`
      SELECT l.*, s.name AS from_name FROM loans l
      JOIN stations s ON s.id = l.from_station_id
      WHERE l.user_id = ? AND l.status = 'active' LIMIT 1
    `).get(user.id);
    if (!loan) throw fail(409, '当前没有待归还的雨伞');
    const toStation = db.prepare('SELECT * FROM stations WHERE id = ?').get(stationId);
    if (!toStation) throw fail(404, '归还伞点不存在');
    const now = new Date();
    const duration = Math.max(1, Math.round((now.getTime() - new Date(loan.borrowed_at).getTime()) / 60000));
    const damaged = condition === 'damaged';
    if (damaged) {
      db.prepare('UPDATE stations SET damaged = damaged + 1 WHERE id = ?').run(stationId);
    } else {
      db.prepare('UPDATE stations SET available = MIN(capacity, available + 1) WHERE id = ?').run(stationId);
    }
    const creditDelta = damaged ? -5 : 1;
    const nextCredit = Math.max(0, Math.min(100, user.credit + creditDelta));
    db.prepare('UPDATE users SET credit = ? WHERE id = ?').run(nextCredit, user.id);
    db.prepare(`
      UPDATE loans SET to_station_id = ?, returned_at = ?, duration_min = ?, condition = ?, status = 'returned'
      WHERE id = ?
    `).run(stationId, now.toISOString(), duration, damaged ? 'minor' : 'good', loan.id);
    insertActivity(user, '归还雨伞', toStation.name, damaged ? '已报修 · 信用 -5' : '用时 ' + (duration < 60 ? duration + ' 分钟' : Math.floor(duration / 60) + ' 小时 ' + (duration % 60) + ' 分'));
    bumpDaily('return');
    return {
      trip: {
        id: loan.id,
        code: loan.code,
        from: loan.from_name,
        to: toStation.name,
        borrowedAt: loan.borrowed_at,
        returnedAt: now.toISOString(),
        duration,
        condition: damaged ? 'minor' : 'good',
        status: 'returned'
      },
      creditDelta,
      credit: nextCredit
    };
  });
  sendJson(res, 200, { ok: true, ...result });
}

async function handlePledge(req, res) {
  const session = requireAuth(req);
  const user = session.user;
  db.prepare('INSERT OR IGNORE INTO pledges (user_id, signed_at) VALUES (?, ?)').run(user.id, isoNow());
  sendJson(res, 200, { ok: true, pledge: getPledgeState(user.id) });
}

async function handleRestock(req, res) {
  const session = requireAdmin(req);
  const body = await readJson(req);
  const stationId = String(body.stationId || '');
  const result = transaction(() => {
    const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(stationId);
    if (!station) throw fail(404, '伞点不存在');
    const amount = Math.min(8, station.capacity - station.available);
    if (amount <= 0) throw fail(409, '该伞点柜格已满');
    db.prepare('UPDATE stations SET available = available + ? WHERE id = ?').run(amount, stationId);
    insertActivity(session.user, '补充雨伞', station.name, '补充 ' + amount + ' 把');
    return { amount, stationId, stationName: station.name };
  });
  sendJson(res, 200, { ok: true, ...result });
}

function handleResolveAlert(req, res, alertId) {
  requireAdmin(req);
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId);
  if (!alert) throw fail(404, '告警不存在');
  db.prepare('UPDATE alerts SET resolved = 1 WHERE id = ?').run(alertId);
  sendJson(res, 200, { ok: true });
}

function handleResolveAll(req, res) {
  requireAdmin(req);
  const result = db.prepare('UPDATE alerts SET resolved = 1 WHERE resolved = 0').run();
  sendJson(res, 200, { ok: true, count: Number(result.changes) });
}

function handleAdminReset(req, res) {
  const session = requireAdmin(req);
  transaction(() => {
    db.exec('DELETE FROM loans; DELETE FROM activities; DELETE FROM alerts; DELETE FROM pledges; DELETE FROM daily_stats; DELETE FROM stations; DELETE FROM users; DELETE FROM app_settings;');
    seedDatabase();
    db.prepare('DELETE FROM sessions WHERE token <> ?').run(session.token);
  });
  sendJson(res, 200, { ok: true });
}

async function handleApi(req, res, pathname) {
  const method = req.method || 'GET';
  if (method === 'GET' && pathname === '/api/public-config') {
    return sendJson(res, 200, getPublicConfig());
  }
  if (method === 'POST' && pathname === '/api/login') {
    return handleLogin(req, res);
  }
  if (method === 'POST' && pathname === '/api/demo-login') {
    return handleDemoLogin(req, res);
  }
  if (method === 'POST' && pathname === '/api/logout') {
    return handleLogout(req, res);
  }
  if (method === 'GET' && pathname === '/api/bootstrap') {
    const session = requireAuth(req);
    return sendJson(res, 200, buildBootstrap(session.user));
  }
  if (method === 'POST' && pathname === '/api/borrow') {
    return handleBorrow(req, res);
  }
  if (method === 'POST' && pathname === '/api/return') {
    return handleReturn(req, res);
  }
  if (method === 'POST' && pathname === '/api/pledge') {
    return handlePledge(req, res);
  }
  if (method === 'POST' && pathname === '/api/restock') {
    return handleRestock(req, res);
  }
  if (method === 'POST' && pathname === '/api/alerts/resolve-all') {
    return handleResolveAll(req, res);
  }
  const alertMatch = pathname.match(/^\/api\/alerts\/([^/]+)\/resolve$/);
  if (method === 'POST' && alertMatch) {
    return handleResolveAlert(req, res, decodeURIComponent(alertMatch[1]));
  }
  if (method === 'POST' && pathname === '/api/admin/reset') {
    return handleAdminReset(req, res);
  }
  sendJson(res, 404, { error: '接口不存在' });
}

/* --------------------------------------------------------------------------
   Static files
   -------------------------------------------------------------------------- */

function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }
  if (decoded === '/') decoded = '/index.html';
  const filePath = path.resolve(ROOT, '.' + decoded);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff'
    };
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://' + (req.headers.host || HOST));
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url.pathname);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    if (!res.headersSent) {
      sendJson(res, status, { error: err.message || '服务器内部错误' });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log('南审晴雨数据库版已启动：http://' + HOST + ':' + PORT);
  console.log('数据库文件：' + DB_PATH);
  console.log('演示密码：' + DEMO_PASSWORD);
});
