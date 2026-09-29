#!/usr/bin/env node
// 喂奶记录 · 云同步命令行（在盒子上运行）：用与手机相同的同步密钥（frs1_…）记录 / 查看 / 修改 / 删除喂奶。
// 密钥与服务地址保存在 ~/.config/feed-record/sync.env（权限 600，不在仓库里；与宝宝记录的 ~/.config/baby-record/ 完全分开）。
// 时间按 Asia/Shanghai（可用环境变量 TZ 覆盖）。
//
//   node feed.js init [--url https://…]        生成同步密钥（已有则保留）并保存；默认用 site/config.js 里的 syncApi
//   node feed.js use-key                        采用环境变量 $FEED_SYNC_KEY 里的密钥（例如手机生成的），只显示指纹
//   node feed.js set-url https://…              设置 Worker 地址
//   node feed.js status                         配置、云端记录数、间隔
//   node feed.js pair [--qr 文件.png] [--text]   给手机的配对二维码（内容 …/feed-record/#pair=<密钥>）；不加 --qr 则打印
//   node feed.js add [--at 20:15|-20m|"20分钟前"|"2026-09-29 20:15"] [--side 左|右|两边] [--left 15] [--right 10] [--note 备注]
//   node feed.js last                           最近一次 + 下次喂奶时间 + 应响的闹钟
//   node feed.js list [--days 2] [--json]       按天列出（默认今天和昨天）
//   node feed.js edit <id> [--at …] [--side …] [--left …] [--right …] [--note …]
//   node feed.js delete <id>
// ⚠️ 从这里记录的喂奶不会自动重设手机上的「喂奶闹钟」：手机打开 App 后首页会提示「iPhone 闹钟还没更新」，点一下才会重设。
process.env.TZ ||= 'Asia/Shanghai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const core = await import('../site/js/sync-core.js');
const F = await import('../site/js/feeds.js');
const S = await import('../site/js/shortcuts.js');

const ENV_FILE = process.env.FEED_SYNC_ENV || path.join(os.homedir(), '.config/feed-record/sync.env');
const APP_URL = process.env.FEED_APP_URL || 'https://lj-lioo.github.io/feed-record/';
function defaultUrl() {
  const m = /syncApi:\s*'([^']*)'/.exec(fs.readFileSync(path.join(here, '../site/config.js'), 'utf8'));
  return m ? m[1] : '';
}

function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || (v.startsWith('--'))) opt[k] = true; else { opt[k] = v; i++; }
    } else pos.push(a);
  }
  return { pos, opt };
}
function readFile() {
  const out = {};
  if (!fs.existsSync(ENV_FILE)) return out;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = /^\s*(FEED_SYNC_URL|FEED_SYNC_KEY)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1] === 'FEED_SYNC_URL' ? 'url' : 'key'] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
function readEnv() {
  const f = readFile();
  return { url: (process.env.FEED_SYNC_URL || f.url || '').replace(/\/+$/, ''), key: core.extractSyncKey(process.env.FEED_SYNC_KEY || f.key || '') };
}
function writeEnv({ url, key }) {
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(ENV_FILE, `# 喂奶记录云同步（勿分享：密钥可读写全部喂奶记录）\nFEED_SYNC_URL=${url || ''}\nFEED_SYNC_KEY=${key}\n`, { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600);
}
const fingerprint = (k) => `${k.slice(0, 7)}…${k.slice(-3)}`;
function need(cfg, url = true) {
  if (!cfg.key) throw new Error(`还没有同步密钥：先运行 node feed.js init 或 use-key（配置文件 ${ENV_FILE}）`);
  if (url && !cfg.url) throw new Error('还没有设置 Worker 地址：node feed.js set-url https://…');
}

async function pullAll(cfg, keys) {
  const feeds = new Map();
  let prefs = null, cursor = 0;
  for (let i = 0; i < 100; i++) {
    const res = await core.syncRequest(cfg.url, keys.token, { since: cursor, changes: [] });
    for (const r of res.changes) {
      if (r.id.startsWith(core.FEED_PREFIX)) {
        const id = r.id.slice(core.FEED_PREFIX.length);
        if (r.deleted) { feeds.delete(id); continue; }
        try { const o = await core.unseal(keys.enc, r.id, r.updatedAt, r.data); if (o?.type === 'feed') feeds.set(id, { rec: r, feed: F.normalizeFeed({ ...o.feed, id, updatedAt: r.updatedAt }) }); } catch { console.warn(`⚠️ 无法解密 ${r.id}`); }
      } else if (r.id === core.PREFS_ID && !r.deleted) {
        try { const o = await core.unseal(keys.enc, r.id, r.updatedAt, r.data); prefs = { ...o.prefs, updatedAt: r.updatedAt }; } catch { /* ignore */ }
      }
    }
    cursor = res.cursor;
    if (!res.more) break;
  }
  return { feeds, prefs, cursor };
}
async function pushFeeds(cfg, keys, items) {
  const changes = [];
  for (const { feed, deleted } of items) {
    const rid = core.FEED_PREFIX + feed.id;
    changes.push(deleted ? { id: rid, updatedAt: feed.updatedAt, deleted: true, data: null }
      : { id: rid, updatedAt: feed.updatedAt, deleted: false, data: await core.seal(keys.enc, rid, feed.updatedAt, { type: 'feed', feed }) });
  }
  const res = await core.syncRequest(cfg.url, keys.token, { since: 0, changes });
  const rejected = changes.filter((c) => !res.accepted.includes(c.id));
  if (rejected.length) throw new Error(`云端已有更新的版本，未写入：${rejected.map((c) => c.id).join(', ')}`);
  return res;
}

const fmt = (f, now = Date.now()) => `${F.whenText(f.start, now)}  ${f.side ? F.SIDES[f.side] : '—'}${f.minL ? `  左${f.minL}` : ''}${f.minR ? `  右${f.minR}` : ''}${f.note ? `  （${f.note}）` : ''}${f.source === 'box-cli' ? '  [助手]' : ''}  [${f.id}]`;
function nextInfo(list, prefs) {
  const iv = F.clampInterval(prefs?.intervalMin ?? F.DEFAULT_INTERVAL_MIN), n = F.clampCount(prefs?.alarmCount ?? F.DEFAULT_ALARM_COUNT);
  const plan = S.alarmPlan({ feeds: list, intervalMin: iv, count: n });
  if (plan.clear) return '还没有喂奶记录';
  const last = plan.last, next = last.start + iv * 60000, left = next - Date.now();
  return [`距上次喂奶 ${F.dur(Date.now() - last.start)}；下次喂奶 ${F.whenText(next)}（${left >= 0 ? `还有 ${F.dur(left)}` : `已超时 ${F.dur(-left)}`}，间隔 ${F.intervalText(iv)}）`,
    `手机上应响的闹钟：${plan.lines.map((l) => F.whenText(l.at)).join('、')}`].join('\n');
}
function feedFromOpts(opt, base = {}) {
  const out = { ...base };
  if (opt.at !== undefined) {
    out.start = F.parseWhen(String(opt.at));
    if (out.start > Date.now() + 5 * 60000) throw new Error('开始时间不能晚于现在');
  }
  if (opt.side !== undefined) out.side = F.parseSide(String(opt.side));
  if (opt.left !== undefined) out.minL = Number(opt.left);
  if (opt.right !== undefined) out.minR = Number(opt.right);
  if (opt.note !== undefined) out.note = String(opt.note === true ? '' : opt.note);
  for (const k of ['minL', 'minR']) if (out[k] !== undefined && !(Number.isFinite(out[k]) && out[k] >= 0 && out[k] <= 180)) throw new Error('分钟数应在 0～180');
  // 侧别跟分钟数对齐：只填了分钟就推断侧别；左边的记录又加了右边分钟 → 两边
  const L = out.minL || 0, R = out.minR || 0;
  if (!out.side && (L || R)) out.side = L && R ? 'B' : L ? 'L' : 'R';
  else if ((out.side === 'L' && R) || (out.side === 'R' && L)) out.side = 'B';
  return out;
}

async function main() {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  const { pos, opt } = parseArgs(rest);
  const cfg = readEnv();

  if (cmd === 'init') {
    const url = typeof opt.url === 'string' ? opt.url.replace(/\/+$/, '') : (cfg.url || defaultUrl());
    const key = cfg.key || core.newSyncKey();
    writeEnv({ url, key });
    console.log(`${cfg.key ? '已有' : '已生成新的'}同步密钥（${fingerprint(key)}），保存在 ${ENV_FILE}`);
    console.log(`Worker 地址：${url || '（未设置）'}`);
    return;
  }
  if (cmd === 'use-key') {
    const raw = process.env.FEED_SYNC_KEY || '';
    const key = core.extractSyncKey(raw);
    if (!raw) throw new Error('环境变量 FEED_SYNC_KEY 是空的');
    if (!key) throw new Error(/brs1_/.test(raw) ? '这是「宝宝记录」的密钥（brs1_），喂奶记录需要 frs1_ 开头的密钥' : 'FEED_SYNC_KEY 不是有效的同步密钥（应为 frs1_ 开头、共 48 位）');
    const file = readFile();
    if (file.key && file.key !== key) { fs.copyFileSync(ENV_FILE, ENV_FILE + '.bak'); fs.chmodSync(ENV_FILE + '.bak', 0o600); }
    writeEnv({ url: file.url || cfg.url || defaultUrl(), key });
    console.log(`已采用同步密钥（${fingerprint(key)}），保存在 ${ENV_FILE}${file.key && file.key !== key ? `；旧密钥（${fingerprint(file.key)}）备份在 ${ENV_FILE}.bak` : ''}`);
    return;
  }
  if (cmd === 'set-url') {
    const url = (pos[0] || '').replace(/\/+$/, '');
    if (!/^https?:\/\//.test(url)) throw new Error('用法：set-url https://…');
    writeEnv({ url, key: cfg.key || core.newSyncKey() });
    console.log(`已保存 Worker 地址：${url}`);
    return;
  }
  if (cmd === 'pair') {
    need(cfg, false);
    const payload = opt.text ? cfg.key : `${APP_URL}#pair=${cfg.key}`;
    if (typeof opt.qr === 'string') {
      const QR = (await import('qrcode')).default;
      await QR.toFile(opt.qr, payload, { width: 560, margin: 3, errorCorrectionLevel: 'M' });
      fs.chmodSync(opt.qr, 0o600);
      console.log(`二维码已保存到 ${opt.qr}（含同步密钥，扫完请删除）`);
    } else console.log(payload);
    return;
  }
  if (cmd === 'help' || cmd === '--help') {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 19).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }

  need(cfg);
  const keys = await core.deriveKeys(cfg.key);
  if (cmd === 'status') {
    const { feeds, prefs, cursor } = await pullAll(cfg, keys);
    console.log(`配置文件：${ENV_FILE}\nWorker：${cfg.url}\n密钥：${fingerprint(cfg.key)}\n云端喂奶记录：${feeds.size} 条；间隔 ${F.intervalText(F.clampInterval(prefs?.intervalMin ?? 240))}，闹钟 ${F.clampCount(prefs?.alarmCount ?? 3)} 次；游标 ${cursor}`);
    return;
  }
  if (cmd === 'add') {
    const { feeds, prefs } = await pullAll(cfg, keys);
    const base = feedFromOpts(opt, { start: Date.now() });
    if (opt.side === undefined && !base.side) base.side = F.suggestSide([...feeds.values()].map((x) => x.feed)).side;
    const now = Date.now();
    const d = new Date(base.start); d.setSeconds(0, 0);
    const feed = F.normalizeFeed({ ...base, start: d.getTime(), id: F.uid(), createdAt: now, updatedAt: now, source: 'box-cli' });
    await pushFeeds(cfg, keys, [{ feed }]);
    const list = [...[...feeds.values()].map((x) => x.feed), feed];
    console.log(`已记录：${fmt(feed)}`);
    console.log(nextInfo(list, prefs));
    if (F.latestFeed(list).id === feed.id) console.log('⚠️ 手机上的「喂奶闹钟」还没重设：打开「喂奶记录」App，首页点「更新闹钟」。');
    return;
  }

  const { feeds, prefs } = await pullAll(cfg, keys);
  const list = [...feeds.values()].map((x) => x.feed);
  if (cmd === 'last' || cmd === 'next') {
    const last = F.latestFeed(list);
    if (last) console.log(`最近一次：${fmt(last)}`);
    console.log(nextInfo(list, prefs));
    return;
  }
  if (cmd === 'list') {
    const days = Math.max(1, Number(opt.days) || 2);
    const from = F.addDaysMs(F.dayStart(Date.now()), -(days - 1));
    const sel = F.sortDesc(list).filter((f) => f.start >= from);
    if (opt.json) { console.log(JSON.stringify(sel, null, 2)); return; }
    for (const d of F.groupByDay(sel)) {
      const full = F.daySummary(list, d.day);
      console.log(`== ${F.relDay(d.day)} ${F.cnDate(d.day)} ${F.weekday(d.day)}：${full.count} 次，${full.total} 分钟（左${full.left} 右${full.right}）${full.avgGap ? `，平均间隔 ${F.dur(full.avgGap)}` : ''}`);
      full.feeds.forEach((f) => console.log('  ' + fmt(f)));
    }
    console.log(`共 ${sel.length} 条（最近 ${days} 天，--days N 看更多）`);
    return;
  }
  if (cmd === 'edit' || cmd === 'delete') {
    const hit = feeds.get(pos[0] || '');
    if (!hit) throw new Error(`找不到记录 ${pos[0] || ''}（先 list 看 id）`);
    const wasLatest = F.latestFeed(list).id === hit.feed.id;
    const updatedAt = Math.max(Date.now(), hit.rec.updatedAt + 1);
    if (cmd === 'delete') {
      await pushFeeds(cfg, keys, [{ feed: { ...hit.feed, updatedAt }, deleted: true }]);
      console.log(`已删除：${fmt(hit.feed)}`);
      const rest2 = list.filter((f) => f.id !== hit.feed.id);
      console.log(nextInfo(rest2, prefs));
      if (wasLatest) console.log('⚠️ 删的是最近一次：手机上打开 App 点「更新闹钟」重设。');
      return;
    }
    const feed = F.normalizeFeed({ ...feedFromOpts(opt, hit.feed), id: hit.feed.id, updatedAt });
    await pushFeeds(cfg, keys, [{ feed }]);
    console.log(`已修改：${fmt(feed)}`);
    const list2 = list.map((f) => (f.id === feed.id ? feed : f));
    console.log(nextInfo(list2, prefs));
    if (S.alarmSig(list2, prefs?.intervalMin, prefs?.alarmCount) !== S.alarmSig(list, prefs?.intervalMin, prefs?.alarmCount)) console.log('⚠️ 闹钟时间变了：手机上打开 App 点「更新闹钟」重设。');
    return;
  }
  throw new Error(`未知命令 ${cmd}（node feed.js help）`);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
