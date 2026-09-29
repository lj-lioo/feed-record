// 数据层：全部保存在本机 localStorage（无需登录）。键名用 feedrecord.* —— 和「宝宝记录」同一个网站来源（lj-lioo.github.io），不能重名。
import { normalizeFeed, uid, sortDesc, clampCount, clampInterval, DEFAULT_INTERVAL_MIN, DEFAULT_ALARM_COUNT } from './feeds.js';
import { DEFAULT_SHORTCUT } from './shortcuts.js';

const KEY = 'feedrecord.v1';
const SCHEMA_VERSION = 1;

function defaults() {
  return {
    version: SCHEMA_VERSION,
    feeds: [],                 // 喂奶记录 {id, start, side:'L'|'R'|'B'|'', minL, minR, note, createdAt, updatedAt}
    fired: {},                 // App 内全屏闹钟已确认的 key -> 时间
    snooze: null,              // App 内「稍后提醒」{at, key}
    alarm: { sig: '', sentAt: 0, times: [] },  // 最近一次交给快捷指令的闹钟（本机状态，不同步）
    settings: {
      intervalMin: DEFAULT_INTERVAL_MIN,
      alarmCount: DEFAULT_ALARM_COUNT,
      shortcutName: DEFAULT_SHORTCUT,
      autoShortcut: true,      // 点「完成」后自动打开快捷指令重设闹钟
      sound: true,
      babyName: '',
      babyBirthday: '2026-09-17',
      prefsUpdatedAt: 0,       // 间隔/次数/宝宝资料的修改时间（云同步用）
    },
  };
}

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrate(JSON.parse(raw)) : defaults();
  } catch (e) { console.warn('读取数据失败，使用空数据', e); return defaults(); }
}
function migrate(data) {
  const d = defaults();
  const out = { ...d, ...data, settings: { ...d.settings, ...(data.settings || {}) }, alarm: { ...d.alarm, ...(data.alarm || {}) } };
  out.feeds = (out.feeds || []).filter((f) => f && Number.isFinite(Number(f.start))).map(normalizeFeed);
  out.settings.intervalMin = clampInterval(out.settings.intervalMin);
  out.settings.alarmCount = clampCount(out.settings.alarmCount);
  out.version = SCHEMA_VERSION;
  return out;
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); } });
}
const PREF_KEYS = ['intervalMin', 'alarmCount', 'babyName', 'babyBirthday'];

export const store = {
  get state() { return state; },
  get settings() { return state.settings; },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  feeds() { return state.feeds; },
  sorted() { return sortDesc(state.feeds); },
  getFeed(id) { return state.feeds.find((f) => f.id === id); },
  addFeed(f) {
    const now = Date.now();
    const feed = normalizeFeed({ ...f, id: f.id || uid(), createdAt: now, updatedAt: now });
    state.feeds.push(feed); save();
    return feed;
  },
  updateFeed(id, patch) {
    const i = state.feeds.findIndex((f) => f.id === id);
    if (i < 0) return null;
    state.feeds[i] = normalizeFeed({ ...state.feeds[i], ...patch, id, updatedAt: Math.max(Date.now(), state.feeds[i].updatedAt + 1) });
    save();
    return state.feeds[i];
  },
  deleteFeed(id) { state.feeds = state.feeds.filter((f) => f.id !== id); save(); },
  markAlarmSent(plan) { state.alarm = { sig: plan.sig, sentAt: Date.now(), times: plan.lines.map((l) => l.at) }; save(); },
  markFired(key) {
    state.fired[key] = Date.now();
    const cutoff = Date.now() - 7 * 864e5;
    for (const k of Object.keys(state.fired)) if (state.fired[k] < cutoff) delete state.fired[k];
    save();
  },
  isFired(key) { return !!state.fired[key]; },
  setSnooze(s) { state.snooze = s; save(); },
  updateSettings(patch) {
    if (PREF_KEYS.some((k) => k in patch) && !('prefsUpdatedAt' in patch)) patch = { ...patch, prefsUpdatedAt: Date.now() };
    if ('intervalMin' in patch) patch.intervalMin = clampInterval(patch.intervalMin);
    if ('alarmCount' in patch) patch.alarmCount = clampCount(patch.alarmCount);
    state.settings = { ...state.settings, ...patch }; save();
  },
  prefs() { const s = state.settings; return { intervalMin: s.intervalMin, alarmCount: s.alarmCount, babyName: s.babyName, babyBirthday: s.babyBirthday }; },
  // 云同步：应用其他设备 / 盒子命令行的修改（保留对方的 updatedAt，只保存一次）
  applyRemote({ upserts = [], deletes = [], prefs = null } = {}) {
    if (!upserts.length && !deletes.length && !prefs) return;
    const del = new Set(deletes);
    state.feeds = state.feeds.filter((f) => !del.has(f.id));
    for (const f of upserts) {
      const n = normalizeFeed(f);
      const i = state.feeds.findIndex((x) => x.id === n.id);
      if (i >= 0) state.feeds[i] = n; else state.feeds.push(n);
    }
    if (prefs) {
      const p = {};
      for (const k of PREF_KEYS) if (k in prefs) p[k] = prefs[k];
      state.settings = { ...state.settings, ...p, intervalMin: clampInterval(p.intervalMin ?? state.settings.intervalMin), alarmCount: clampCount(p.alarmCount ?? state.settings.alarmCount), prefsUpdatedAt: prefs.updatedAt };
    }
    save();
  },
  exportJSON() { return JSON.stringify({ app: 'feed-record', exportedAt: new Date().toISOString(), data: state }, null, 2); },
  importJSON(text) {
    const parsed = JSON.parse(text);
    const data = parsed && parsed.data ? parsed.data : parsed;
    if (!data || !Array.isArray(data.feeds)) throw new Error('文件格式不正确（不是喂奶记录的备份）');
    const alarm = state.alarm;
    state = migrate(data);
    state.alarm = alarm;   // 本机闹钟状态保留：导入后如有变化会提示重设
    save();
    return state.feeds.length;
  },
  resetAll() { state = defaults(); save(); },
};
