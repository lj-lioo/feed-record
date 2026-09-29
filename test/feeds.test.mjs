// 单元测试：下次喂奶时间计算（提前喂奶重置、编辑/删除最近一次、跨午夜、侧别建议、每日汇总、时间解析）
// 运行：TZ=Asia/Shanghai node --test test/feeds.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../site/js/feeds.js';
import { alarmSig, alarmPlan } from '../site/js/shortcuts.js';

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
const feed = (id, t, side = 'L', minL = 0, minR = 0) => F.normalizeFeed({ id, start: t, side, minL, minR });

test('运行在 Asia/Shanghai 时区', () => {
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, 'Asia/Shanghai');
  assert.equal(new Date(at(2026, 9, 29, 20, 15)).toISOString(), '2026-09-29T12:15:00.000Z');
});

test('下次喂奶 = 最近一次 + 4 小时（默认），跨午夜到第二天', () => {
  const feeds = [feed('a', at(2026, 9, 29, 20, 15))];
  const next = F.nextFeedAt(feeds);
  assert.equal(F.stamp(next), '2026-09-30 00:15');
  assert.equal(F.DEFAULT_INTERVAL_MIN, 240);
});

test('提前喂奶（2小时后又喂）：从最近一次重新算，旧时间不再出现', () => {
  const feeds = [feed('a', at(2026, 9, 29, 20, 15)), feed('b', at(2026, 9, 29, 22, 15), 'R')];
  assert.equal(F.stamp(F.nextFeedAt(feeds)), '2026-09-30 02:15');
  const slots = F.alarmSlots(feeds, 240, 3).map((s) => F.stamp(s.at));
  assert.deepEqual(slots, ['2026-09-30 02:15', '2026-09-30 06:15', '2026-09-30 10:15']);
  assert.ok(!slots.includes('2026-09-30 00:15'));
});

test('补记一条更早的喂奶：不影响下次时间和闹钟签名', () => {
  const feeds = [feed('b', at(2026, 9, 29, 22, 15))];
  const sig = alarmSig(feeds);
  const more = [...feeds, feed('old', at(2026, 9, 29, 18, 0))];
  assert.equal(F.stamp(F.nextFeedAt(more)), '2026-09-30 02:15');
  assert.equal(alarmSig(more), sig);
});

test('编辑最近一次：改开始时间/侧别 → 签名变（需重设）；只改分钟数/备注 → 签名不变', () => {
  const f = feed('a', at(2026, 9, 29, 20, 15), 'L', 10);
  const sig = alarmSig([f]);
  assert.notEqual(alarmSig([{ ...f, start: at(2026, 9, 29, 19, 55) }]), sig);
  assert.equal(F.stamp(F.nextFeedAt([{ ...f, start: at(2026, 9, 29, 19, 55) }])), '2026-09-29 23:55');
  assert.notEqual(alarmSig([{ ...f, side: 'B' }]), sig);
  assert.equal(alarmSig([{ ...f, minL: 25, minR: 5, note: '吐奶' }]), sig);
});

test('删除最近一次：回到上一次重新算；全部删除 → CLEAR', () => {
  const a = feed('a', at(2026, 9, 29, 20, 15)), b = feed('b', at(2026, 9, 29, 22, 15));
  const after = [a];
  assert.equal(F.stamp(F.nextFeedAt(after)), '2026-09-30 00:15');
  assert.notEqual(alarmSig(after), alarmSig([a, b]));
  assert.equal(alarmSig([]), 'CLEAR');
  assert.equal(F.nextFeedAt([]), null);
  assert.equal(alarmPlan({ feeds: [] }).clear, true);
});

test('间隔和次数可配置并有范围', () => {
  const feeds = [feed('a', at(2026, 9, 29, 23, 30))];
  assert.equal(F.stamp(F.nextFeedAt(feeds, 180)), '2026-09-30 02:30');
  assert.deepEqual(F.alarmSlots(feeds, 150, 2).map((s) => F.hm(s.at)), ['02:00', '04:30']);
  assert.equal(F.clampCount(0), 3);  // 0 / 非数字 → 默认 3
  assert.equal(F.clampCount(-2), 1);
  assert.equal(F.clampCount(9), 6);
  assert.equal(F.alarmSlots(feeds, 240, 6).length, 6);
  assert.equal(F.clampInterval(10), 30);
});

test('跨午夜 / 跨多天：23:50 喂 → 03:50、07:50、11:50（第二天）', () => {
  const feeds = [feed('a', at(2026, 12, 31, 23, 50))];
  assert.deepEqual(F.alarmSlots(feeds).map((s) => F.stamp(s.at)), ['2027-01-01 03:50', '2027-01-01 07:50', '2027-01-01 11:50']);
});

test('建议侧别：左→右，右→左，两边→少的一边', () => {
  assert.equal(F.suggestSide([]).side, 'L');
  assert.equal(F.suggestSide([feed('a', 1000, 'L')]).side, 'R');
  assert.equal(F.suggestSide([feed('a', 1000, 'L'), feed('b', 2000, 'R')]).side, 'L');
  assert.equal(F.suggestSide([feed('a', 1000, 'B', 15, 10)]).side, 'R');
  assert.equal(F.suggestSide([feed('a', 1000, 'B', 5, 10)]).side, 'L');
  assert.equal(F.suggestSide([feed('a', 1000, 'R'), feed('b', 2000, '')]).side, 'L'); // 没填侧别的跳过
});

test('每日汇总：次数、分钟、平均间隔（按本地日期分组，跨午夜）', () => {
  const feeds = [
    feed('y', at(2026, 9, 28, 22, 0), 'L', 10),
    feed('a', at(2026, 9, 29, 1, 30), 'R', 0, 12),
    feed('b', at(2026, 9, 29, 5, 0), 'B', 8, 7),
    feed('c', at(2026, 9, 29, 23, 59), 'L', 5),
  ];
  const d = F.daySummary(feeds, at(2026, 9, 29, 12, 0));
  assert.equal(d.count, 3);
  assert.equal(d.total, 32);
  assert.equal(d.left, 13); assert.equal(d.right, 19);
  assert.equal(d.avgGap, Math.round((210 + 210 + 1139) * 60000 / 3));  // 前一天 22:00 → 01:30 也算一个间隔
  const days = F.groupByDay(feeds);
  assert.equal(days.length, 2);
  assert.equal(F.ymd(days[0].day), '2026-09-29');
  assert.equal(days[1].count, 1);
});

test('宝宝第几天：2026-09-17 出生，9月29日是第13天', () => {
  assert.equal(F.babyAgeDays('2026-09-17', at(2026, 9, 29, 20, 0)), 13);
  assert.equal(F.babyAgeDays('2026-09-17', at(2026, 9, 17, 8, 0)), 1);
});

test('解析开始时间：20:15、-20m、20分钟前、1h30m 前、完整日期', () => {
  const now = at(2026, 9, 29, 20, 30);
  assert.equal(F.parseWhen('20:15', now), at(2026, 9, 29, 20, 15));
  assert.equal(F.parseWhen('23:50', now), at(2026, 9, 28, 23, 50)); // 未来时间 → 昨天
  assert.equal(F.parseWhen('-20m', now), now - 20 * 60000);
  assert.equal(F.parseWhen('20分钟前', now), now - 20 * 60000);
  assert.equal(F.parseWhen('-1h30m', now), now - 90 * 60000);
  assert.equal(F.parseWhen('2026-09-29 19:05', now), at(2026, 9, 29, 19, 5));
  assert.throws(() => F.parseWhen('昨天晚上', now));
  assert.equal(F.parseSide('左'), 'L'); assert.equal(F.parseSide('both'), 'B'); assert.throws(() => F.parseSide('中'));
});
