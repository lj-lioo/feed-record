// 喂奶记录 · 纯函数（浏览器与盒子命令行共用，无 DOM、无存储依赖）
// 时间一律用「设备本地时间」：手机在 Asia/Shanghai；快捷指令「从输入中获取日期」也按手机本地时间解析，两边一致。
export const SIDES = { L: '左边', R: '右边', B: '两边' };
export const SIDE_SHORT = { L: '左', R: '右', B: '两边' };
export const DEFAULT_INTERVAL_MIN = 240;   // 默认 4 小时
export const DEFAULT_ALARM_COUNT = 3;      // 默认连响 3 次：+1×、+2×、+3× 间隔
export const MIN_ALARMS = 1, MAX_ALARMS = 6;
const MIN = 60000;

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const hm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const stamp = (ms) => `${ymd(ms)} ${hm(ms)}`;  // 快捷指令用：yyyy-MM-dd HH:mm（本地时间）
export function cnDate(ms) { const d = new Date(ms); return `${d.getMonth() + 1}月${d.getDate()}日`; }
const WEEK = '日一二三四五六';
export const weekday = (ms) => '周' + WEEK[new Date(ms).getDay()];
export function dayStart(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
export function addDaysMs(ms, n) { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); }
export function relDay(ms, now = Date.now()) {
  const n = Math.round((dayStart(ms) - dayStart(now)) / 864e5);
  if (n === 0) return '今天';
  if (n === -1) return '昨天';
  if (n === -2) return '前天';
  if (n === 1) return '明天';
  return `${cnDate(ms)}`;
}
export function whenText(ms, now = Date.now()) { return `${relDay(ms, now)} ${hm(ms)}`; }
export function dur(ms, withSec = false) {
  const neg = ms < 0; ms = Math.abs(ms);
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
  let t = h ? `${h}小时${m ? pad(m) + '分' : ''}` : `${m}分钟`;
  if (withSec && h === 0) t = `${m}分${pad(s)}秒`;
  return neg ? '-' + t : t;
}
export function intervalText(min) { const h = Math.floor(min / 60), m = min % 60; return h ? `${h}小时${m ? m + '分钟' : ''}` : `${m}分钟`; }

export function clampCount(n) { n = Math.round(Number(n) || DEFAULT_ALARM_COUNT); return Math.min(MAX_ALARMS, Math.max(MIN_ALARMS, n)); }
export function clampInterval(min) { min = Math.round(Number(min) || DEFAULT_INTERVAL_MIN); return Math.min(12 * 60, Math.max(30, min)); }

export function normalizeFeed(f) {
  const side = ['L', 'R', 'B'].includes(f.side) ? f.side : '';
  const m = (v) => Math.max(0, Math.min(180, Math.round(Number(v) || 0)));
  return {
    id: String(f.id || uid()),
    start: Number(f.start),
    side,
    minL: m(f.minL), minR: m(f.minR),
    note: String(f.note || ''),
    source: f.source || '',
    createdAt: f.createdAt || Date.now(),
    updatedAt: f.updatedAt || Date.now(),
  };
}
export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

export const sortDesc = (feeds) => [...feeds].filter((f) => Number.isFinite(f.start)).sort((a, b) => b.start - a.start || String(b.id).localeCompare(String(a.id)));
export function latestFeed(feeds) { return sortDesc(feeds)[0] || null; }
export const feedMinutes = (f) => (f.minL || 0) + (f.minR || 0);

// 下一次喂奶时间 = 最近一次喂奶的开始时间 + 间隔。提前喂了就从那次重新算（只看最近一次）。
export function nextFeedAt(feeds, intervalMin = DEFAULT_INTERVAL_MIN) {
  const last = latestFeed(feeds);
  return last ? last.start + clampInterval(intervalMin) * MIN : null;
}
// 名义上的闹钟时间：最近一次 + 1×、2×…N× 间隔
export function alarmSlots(feeds, intervalMin = DEFAULT_INTERVAL_MIN, count = DEFAULT_ALARM_COUNT) {
  const last = latestFeed(feeds);
  if (!last) return [];
  const iv = clampInterval(intervalMin) * MIN;
  return Array.from({ length: clampCount(count) }, (_, i) => ({ k: i + 1, at: last.start + (i + 1) * iv }));
}

export function sideText(f) {
  if (!f || !f.side) return '';
  if (f.side === 'B') return '两边';
  return SIDES[f.side];
}
export function detailText(f) {
  const parts = [];
  if (f.minL) parts.push(`左${f.minL}`);
  if (f.minR) parts.push(`右${f.minR}`);
  if (parts.length) return parts.join(' ') + '分钟';
  return sideText(f);
}

// 建议这次先喂哪边：上次左→右、右→左；上次两边→时间少的那边（一样多则左）
export function suggestSide(feeds) {
  const last = sortDesc(feeds).find((f) => f.side);
  if (!last) return { side: 'L', reason: '' };
  if (last.side === 'L') return { side: 'R', reason: '上次左边' };
  if (last.side === 'R') return { side: 'L', reason: '上次右边' };
  if ((last.minL || 0) > (last.minR || 0)) return { side: 'R', reason: '上次右边喂得少' };
  if ((last.minR || 0) > (last.minL || 0)) return { side: 'L', reason: '上次左边喂得少' };
  return { side: 'L', reason: '上次两边' };
}

// 某天（本地日期）的汇总；gaps 用「这次开始 − 前一次开始」（前一次可以在前一天）
export function daySummary(feeds, dayMs) {
  const s = dayStart(dayMs), e = addDaysMs(s, 1);
  const asc = sortDesc(feeds).reverse();
  const list = asc.filter((f) => f.start >= s && f.start < e);
  const gaps = [];
  for (const f of list) { const i = asc.indexOf(f); if (i > 0) gaps.push(f.start - asc[i - 1].start); }
  const left = list.reduce((a, f) => a + (f.minL || 0), 0), right = list.reduce((a, f) => a + (f.minR || 0), 0);
  return { day: s, count: list.length, left, right, total: left + right, avgGap: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0, feeds: list.reverse() };
}
export function groupByDay(feeds) {
  const days = new Map();
  for (const f of sortDesc(feeds)) { const d = dayStart(f.start); if (!days.has(d)) days.set(d, []); days.get(d).push(f); }
  return [...days.keys()].map((d) => daySummary(feeds, d));
}
export function babyAgeDays(birthday, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday || '')) return null;
  const [y, m, d] = birthday.split('-').map(Number);
  return Math.round((dayStart(now) - new Date(y, m - 1, d).getTime()) / 864e5) + 1; // 出生当天 = 第1天
}

// 解析「开始时间」：'20:15'（今天，若在未来超过5分钟则算昨天）、'-20m' / '20分钟前' / '-1h30m'、'2026-09-29 20:15'、ISO
export function parseWhen(text, now = Date.now()) {
  const t = String(text || '').trim();
  if (!t || t === 'now' || t === '刚刚') return now;
  let m = /^-?\s*(?:(\d+)\s*(?:h|小时))?\s*(?:(\d+)\s*(?:m|min|分钟|分)?)?\s*(?:前|ago)?$/.exec(t);
  if (m && (m[1] || m[2]) && (t.startsWith('-') || /前|ago/.test(t) || /[hm]$/.test(t))) return now - ((+m[1] || 0) * 60 + (+m[2] || 0)) * MIN;
  m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (m) {
    const d = new Date(now); d.setHours(+m[1], +m[2], 0, 0);
    let ms = d.getTime();
    if (ms > now + 5 * MIN) ms = addDaysMs(ms, -1);
    return ms;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(t);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  const ms = Date.parse(t);
  if (Number.isFinite(ms)) return ms;
  throw new Error(`看不懂的时间：${t}（例：20:15、-20m、20分钟前、2026-09-29 20:15）`);
}
export function parseSide(s) {
  const t = String(s || '').trim().toUpperCase();
  if (!t) return '';
  if (['L', 'LEFT', '左', '左边'].includes(t)) return 'L';
  if (['R', 'RIGHT', '右', '右边'].includes(t)) return 'R';
  if (['B', 'BOTH', '两边', '双边', '两侧'].includes(t)) return 'B';
  throw new Error(`侧别只能是 左/右/两边（L/R/B）：${s}`);
}
