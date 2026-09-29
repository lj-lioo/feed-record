// 云同步（可选）：多台设备、以及助手在盒子上用命令行记录的喂奶，双向同步。
// 只有 config.js 配置了 syncApi 才显示；数据在本机加密后再上传（见 sync-core.js）。每条记录「最后写入者胜」，删除用 tombstone。
// 注意：从盒子/另一台设备同步来的「最近一次喂奶」不能自动重设这台 iPhone 的闹钟 —— 需要打开 App 后点一下「更新闹钟」。
import { store } from './store.js';
import * as core from './sync-core.js';

const LS = 'feedrecord.sync';
const FP = core.FEED_PREFIX;
let meta = loadMeta();

// 配对链接 https://…/feed-record/#pair=<密钥>：# 后面的内容浏览器不会发给服务器；读取后立刻从地址栏去掉。
let pendingPairKey = '';
try {
  const m = /^#pair=([^&]+)/.exec(location.hash || '');
  if (m) {
    pendingPairKey = core.extractSyncKey(decodeURIComponent(m[1]));
    history.replaceState(null, '', location.pathname + location.search + '#/settings');
  }
} catch { /* ignore */ }
export function takePendingPairKey() { const k = pendingPairKey; pendingPairKey = ''; return k; }
let keysCache = null, running = null, again = false, timer = null, applying = false;

function loadMeta() {
  try { return { acked: {}, dels: {}, cursor: 0, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return { acked: {}, dels: {}, cursor: 0 }; }
}
function saveMeta() { localStorage.setItem(LS, JSON.stringify(meta)); }
function emit() { window.dispatchEvent(new CustomEvent('sync-status', { detail: syncStatus() })); }

export function syncApiBase() { return String(meta.url || window.FEED_CONFIG?.syncApi || '').replace(/\/+$/, ''); }
export function syncAvailable() { return !!syncApiBase(); }
export function syncStatus() {
  return { available: syncAvailable(), enabled: !!(meta.enabled && meta.key), key: meta.key || '', lastSyncAt: meta.lastSyncAt || 0, lastError: meta.lastError || '', running: !!running };
}
async function keys() {
  if (!keysCache || keysCache.key !== meta.key) keysCache = { key: meta.key, ...(await core.deriveKeys(meta.key)) };
  return keysCache;
}

export async function enableSync(key) {
  const k = key ? core.extractSyncKey(key) : (meta.key || core.newSyncKey());
  if (!k) throw new Error(/brs1_/.test(String(key)) ? '这是「宝宝记录」的密钥，喂奶记录需要 frs1_ 开头的密钥' : '同步密钥格式不正确（应以 frs1_ 开头）');
  if (k !== meta.key) meta = { enabled: true, key: k, url: meta.url, acked: {}, dels: {}, cursor: 0 };
  meta.enabled = true;
  saveMeta();
  await syncNow('enable');
  if (meta.lastError) throw new Error(meta.lastError);
  return syncStatus();
}
export function disableSync() { meta.enabled = false; saveMeta(); emit(); }

const prefsTime = () => store.settings.prefsUpdatedAt || 0;

async function collectChanges(enc) {
  const changes = [];
  const now = Date.now();
  const present = new Set();
  for (const f of store.feeds()) {
    const rid = FP + f.id;
    present.add(rid);
    if (meta.acked[rid] !== f.updatedAt) changes.push({ id: rid, updatedAt: f.updatedAt, deleted: false, data: await core.seal(enc, rid, f.updatedAt, { type: 'feed', feed: f }) });
  }
  for (const rid of Object.keys(meta.acked)) {
    if (!rid.startsWith(FP) || present.has(rid)) continue;
    if (!meta.dels[rid]) meta.dels[rid] = Math.max(now, meta.acked[rid] + 1);
    if (meta.acked[rid] !== meta.dels[rid]) changes.push({ id: rid, updatedAt: meta.dels[rid], deleted: true, data: null });
  }
  const pt = prefsTime();
  if (pt && meta.acked[core.PREFS_ID] !== pt) {
    changes.push({ id: core.PREFS_ID, updatedAt: pt, deleted: false, data: await core.seal(enc, core.PREFS_ID, pt, { type: 'prefs', prefs: store.prefs() }) });
  }
  return changes.slice(0, 500);
}

async function applyRemote(records, enc) {
  const upserts = [], deletes = [];
  let prefs = null;
  const local = new Map(store.feeds().map((f) => [FP + f.id, f]));
  for (const r of records) {
    if (r.id.startsWith(FP)) {
      const cur = local.get(r.id);
      const localT = cur ? cur.updatedAt : (meta.dels[r.id] || 0);
      if (r.updatedAt <= localT) { if (r.updatedAt === localT) meta.acked[r.id] = r.updatedAt; continue; }
      if (r.deleted) {
        if (cur) deletes.push(cur.id);
        meta.dels[r.id] = r.updatedAt;
      } else {
        let obj;
        try { obj = await core.unseal(enc, r.id, r.updatedAt, r.data); } catch (e) { console.warn('无法解密', r.id, e); continue; }
        if (obj?.type !== 'feed' || !obj.feed) continue;
        upserts.push({ ...obj.feed, id: r.id.slice(FP.length), updatedAt: r.updatedAt });
        delete meta.dels[r.id];
      }
      meta.acked[r.id] = r.updatedAt;
    } else if (r.id === core.PREFS_ID && !r.deleted) {
      if (r.updatedAt <= prefsTime()) { meta.acked[r.id] = Math.max(meta.acked[r.id] || 0, r.updatedAt); continue; }
      try {
        const obj = await core.unseal(enc, r.id, r.updatedAt, r.data);
        prefs = { ...obj.prefs, updatedAt: r.updatedAt };
        meta.acked[r.id] = r.updatedAt;
      } catch (e) { console.warn('无法解密设置', e); }
    }
  }
  applying = true;
  try { store.applyRemote({ upserts, deletes, prefs }); } finally { applying = false; }
  return upserts.length + deletes.length + (prefs ? 1 : 0);
}

export function syncNow(reason = '') {
  if (!syncAvailable() || !meta.enabled || !meta.key) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    emit();
    try {
      for (let round = 0; round < 10; round++) {
        again = false;
        const { token, enc } = await keys();
        const changes = await collectChanges(enc);
        const res = await core.syncRequest(syncApiBase(), token, { since: meta.cursor || 0, changes });
        const sent = new Map(changes.map((c) => [c.id, c.updatedAt]));
        for (const id of res.accepted || []) meta.acked[id] = sent.get(id);
        await applyRemote([...(res.conflicts || []), ...(res.changes || [])], enc);
        meta.cursor = res.cursor;
        saveMeta();
        if (!res.more && !again) break;
      }
      meta.lastSyncAt = Date.now();
      meta.lastError = '';
    } catch (e) {
      meta.lastError = e.message || String(e);
      console.warn('云同步失败', reason, e);
    }
    saveMeta();
    running = null;
    emit();
  })();
  return running;
}

// 打开时、每次修改后（1.5 秒防抖）、切回前台、恢复联网、前台每 1 分钟
export function initSync() {
  if (!syncAvailable()) return;
  store.subscribe(() => {
    if (applying || !meta.enabled) return;
    clearTimeout(timer);
    timer = setTimeout(() => syncNow('change'), 1500);
  });
  document.addEventListener('visibilitychange', () => { if (meta.enabled) syncNow(document.hidden ? 'hidden' : 'visible'); });
  window.addEventListener('online', () => syncNow('online'));
  setInterval(() => { if (!document.hidden) syncNow('interval'); }, 60000);
  syncNow('open');
}
