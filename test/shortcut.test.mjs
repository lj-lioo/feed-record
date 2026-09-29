// 单元测试：快捷指令「喂奶闹钟」传入文本格式与 URL
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFeed } from '../site/js/feeds.js';
import * as S from '../site/js/shortcuts.js';

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
const f = (id, t, extra = {}) => normalizeFeed({ id, start: t, ...extra });
const LINE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}\|[^|\n]+\|[^|\n]+$/;
const now = at(2026, 9, 29, 20, 20);

test('默认 3 行：+4h/+8h/+12h，标题注明第几次和上次时间（没有侧别/分钟）', () => {
  const plan = S.alarmPlan({ feeds: [f('a', at(2026, 9, 29, 20, 15))], now });
  const text = S.payloadText(plan);
  const lines = text.split('\n');
  assert.equal(lines.length, 3);
  lines.forEach((l) => assert.match(l, LINE));
  assert.equal(lines[0], '2026-09-30 00:15|🍼 该喂奶了（第1次 · 上次 20:15）|喂奶记录 · 上次 9月29日 20:15 · 间隔4小时 · 第1次提醒（共3次）');
  assert.ok(lines[1].startsWith('2026-09-30 04:15|🍼 该喂奶了（第2次 · 上次 20:15）|'));
  assert.ok(lines[2].startsWith('2026-09-30 08:15|🍼 该喂奶了（第3次 · 上次 20:15）|'));
});

test('次数 1 和 6、间隔 3 小时；旧记录里的侧别/分钟不会出现在闹钟里', () => {
  const feeds = [f('a', at(2026, 9, 29, 20, 15), { side: 'B', minL: 10, minR: 5, note: '旧备注' })];
  assert.equal(S.alarmPlan({ feeds, count: 1, now }).lines.length, 1);
  const six = S.alarmPlan({ feeds, count: 6, intervalMin: 180, now });
  assert.equal(six.lines.length, 6);
  assert.equal(S.lineText(six.lines[5]).slice(0, 16), '2026-09-30 14:15');
  assert.equal(six.lines[0].title, '🍼 该喂奶了（第1次 · 上次 20:15）');
  assert.equal(six.lines[5].note, '喂奶记录 · 上次 9月29日 20:15 · 间隔3小时 · 第6次提醒（共6次）');
  const text = S.payloadText(six);
  for (const w of ['左', '右', '两边', '分钟', '旧备注']) assert.ok(!text.includes(w), w);
});

test('没有记录 → CLEAR（快捷指令只清空列表）', () => {
  assert.equal(S.payloadText(S.alarmPlan({ feeds: [], now })), 'CLEAR');
  assert.deepEqual(S.parsePayload('CLEAR'), { clear: true, items: [] });
});

test('已超时：第1次已过 → 加一条 1 分钟后响的「已超时」，总数不超过设置的次数', () => {
  const feeds = [f('a', at(2026, 9, 29, 15, 0))];
  const plan = S.alarmPlan({ feeds, now: at(2026, 9, 29, 19, 30) });  // 15:00+4h=19:00 已过
  assert.equal(plan.lines.length, 3);
  assert.ok(plan.lines[0].overdue);
  assert.equal(S.lineText(plan.lines[0]).slice(0, 16), '2026-09-29 19:31');
  assert.match(plan.lines[0].title, /^🍼 该喂奶了（已超时 · 上次 15:00）$/);
  assert.deepEqual(plan.lines.slice(1).map((l) => l.k), [2, 3]);
  // 全部都过了：只剩一条立即响的
  const late = S.alarmPlan({ feeds, now: at(2026, 9, 30, 9, 0) });
  assert.equal(late.lines.length, 1);
  assert.ok(late.lines[0].overdue);
});

test('标题/备注里的 | 和换行会被清理，不会拆坏格式', () => {
  const plan = S.alarmPlan({ feeds: [f('a', at(2026, 9, 29, 20, 15))], now });
  plan.lines[0].note = '有|竖线\n和换行';
  assert.match(S.lineText(plan.lines[0]), LINE);
});

test('URL：shortcuts://run-shortcut?name=喂奶闹钟&input=text&text=…，能原样解码', () => {
  const text = S.payloadText(S.alarmPlan({ feeds: [f('a', at(2026, 9, 29, 20, 15))], now }));
  const url = S.runShortcutUrl('喂奶闹钟', text);
  assert.ok(url.startsWith('shortcuts://run-shortcut?name=%E5%96%82%E5%A5%B6%E9%97%B9%E9%92%9F&input=text&text='));
  const u = new URL(url.replace('shortcuts://', 'https://x/'));
  assert.equal(u.searchParams.get('name'), '喂奶闹钟');
  assert.equal(u.searchParams.get('input'), 'text');
  assert.equal(u.searchParams.get('text'), text);
  assert.ok(!url.includes(' ') && !url.includes('\n') && !url.includes('|'));
});

test('parsePayload：每行按 | 拆成 日期/标题/备注（与快捷指令里的第一项/索引2/最后一项对应）', () => {
  const text = S.payloadText(S.alarmPlan({ feeds: [f('a', at(2026, 9, 29, 20, 15))], now }));
  const p = S.parsePayload(text);
  assert.equal(p.items.length, 3);
  p.items.forEach((it) => { assert.equal(it.fields, 3); assert.match(it.date, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/); });
  assert.equal(p.items[1].title, '🍼 该喂奶了（第2次 · 上次 20:15）');
});

test('测试闹钟：测试行 + 当前真实闹钟一起传（因为快捷指令会先清空列表）', () => {
  const plan = S.alarmPlan({ feeds: [f('a', at(2026, 9, 29, 20, 15))], now });
  const lines = S.testPayload(plan, now).split('\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[0], '2026-09-29 20:22|🍼 测试喂奶闹钟（2分钟后响）|喂奶记录 · 测试紧急提醒是否会像闹钟一样响');
  assert.equal(S.testPayload(S.alarmPlan({ feeds: [], now }), now).split('\n').length, 1);
});
