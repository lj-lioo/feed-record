// iOS 快捷指令「喂奶闹钟」：每次保存最近一次喂奶，都把「接下来的闹钟」整批交给快捷指令。
// 快捷指令先删除「提醒事项」里「喂奶」列表中所有未完成的提醒，再为每一行新建一条「紧急」提醒（iOS 26.2+ 像闹钟一样全屏响铃）。
//
// 传入文本（与「宝宝记录」的「宝宝闹钟」同一格式）：每行一个闹钟，字段用半角 | 分隔
//   2026-09-30 00:15|🍼 该喂奶了（第1次 · 上次 20:15 左边）|喂奶记录 · 上次 9月29日 20:15 左边 · 间隔4小时 · 第1次提醒（共3次）
//   2026-09-30 04:15|🍼 该喂奶了（第2次 · 上次 20:15 左边）|…
// 没有任何喂奶记录时只传 CLEAR：快捷指令只清空列表，不新建。
import { latestFeed, alarmSlots, clampCount, clampInterval, stamp, hm, cnDate, sideText, intervalText, DEFAULT_INTERVAL_MIN, DEFAULT_ALARM_COUNT } from './feeds.js';

export const DEFAULT_SHORTCUT = '喂奶闹钟';
export const CLEAR = 'CLEAR';
const MIN = 60000;
const clean = (s) => String(s || '').replace(/[|\r\n]+/g, ' ').trim();

// 闹钟“签名”：只包含会影响闹钟时间/标题的字段。签名变了 = iPhone 上的闹钟需要重设。
export function alarmSig(feeds, intervalMin = DEFAULT_INTERVAL_MIN, count = DEFAULT_ALARM_COUNT) {
  const last = latestFeed(feeds);
  if (!last) return CLEAR;
  return `${last.id}|${last.start}|${last.side || '-'}|${clampInterval(intervalMin)}|${clampCount(count)}`;
}

// 计算要交给快捷指令的闹钟：
// - 名义时间 = 上次 + k×间隔（k = 1…N）；已经过去的跳过；
// - 如果第1次已经过了（超时了还没喂），加一条 1 分钟后响的「已超时」闹钟，总数仍不超过 N。
export function alarmPlan({ feeds, intervalMin = DEFAULT_INTERVAL_MIN, count = DEFAULT_ALARM_COUNT, now = Date.now() }) {
  const last = latestFeed(feeds);
  const sig = alarmSig(feeds, intervalMin, count);
  if (!last) return { sig, clear: true, lines: [], last: null };
  const N = clampCount(count), iv = clampInterval(intervalMin);
  const side = sideText(last);
  const lastTxt = `上次 ${hm(last.start)}${side ? ' ' + side : ''}`;
  const slots = alarmSlots(feeds, iv, N);
  const lines = [];
  const future = slots.filter((s) => s.at > now + 30000);
  if (future.length < slots.length) {
    const overdue = slots.filter((s) => s.at <= now + 30000).pop();
    lines.push({ k: overdue.k, at: now + MIN, overdue: true,
      title: `🍼 该喂奶了（已超时 · ${lastTxt}）`,
      note: `喂奶记录 · 上次 ${cnDate(last.start)} ${hm(last.start)}${side ? ' ' + side : ''} · 间隔${intervalText(iv)} · 已超过第${overdue.k}次提醒时间 ${hm(overdue.at)}` });
  }
  for (const s of future) {
    if (lines.length >= N) break;
    lines.push({ k: s.k, at: s.at, overdue: false,
      title: `🍼 该喂奶了（第${s.k}次 · ${lastTxt}）`,
      note: `喂奶记录 · 上次 ${cnDate(last.start)} ${hm(last.start)}${side ? ' ' + side : ''} · 间隔${intervalText(iv)} · 第${s.k}次提醒（共${N}次）` });
  }
  return { sig, clear: false, lines, last };
}

export function lineText(l) { return `${stamp(l.at)}|${clean(l.title)}|${clean(l.note)}`; }
export function payloadText(plan) { return plan.clear || !plan.lines.length ? CLEAR : plan.lines.map(lineText).join('\n'); }
export function runShortcutUrl(name, text) {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name || DEFAULT_SHORTCUT)}&input=text&text=${encodeURIComponent(text)}`;
}
// 解析传入文本（测试用，也说明了快捷指令里的处理方式）
export function parsePayload(text) {
  if (text.trim() === CLEAR) return { clear: true, items: [] };
  return { clear: false, items: text.split('\n').map((line) => { const p = line.split('|'); return { date: p[0], title: p[1], note: p[p.length - 1], fields: p.length }; }) };
}
// 测试：2 分钟后响一条测试闹钟，并把当前的真实闹钟一起重建（因为快捷指令会先清空列表）
export function testPayload(plan, now = Date.now()) {
  const test = `${stamp(now + 2 * MIN)}|🍼 测试喂奶闹钟（2分钟后响）|喂奶记录 · 测试紧急提醒是否会像闹钟一样响`;
  return [test, ...(plan.clear ? [] : plan.lines.map(lineText))].join('\n');
}
