// 时区：所有时间按「设备本地时间」生成（手机在 Asia/Shanghai；快捷指令也按手机本地时间解析）。
// 同一个绝对时刻在不同 TZ 下生成的传入文本不同，但都与该设备的本地钟一致；间隔按真实经过的时间（夏令时也正确）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const run = (tz, code) => execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }).trim();
const code = (iso, now) => `
  import { alarmPlan, payloadText } from '${new URL('../site/js/shortcuts.js', import.meta.url).href}';
  const p = alarmPlan({ feeds: [{ id: 'a', start: Date.parse('${iso}') }], now: Date.parse('${now}') });
  console.log(payloadText(p).split('\\n').map((l) => l.slice(0, 16) + ' ' + l.split('|')[1]).join('\\n'));`;

test('Asia/Shanghai：12:15Z = 北京 20:15 → 闹钟 00:15/04:15/08:15（次日）', () => {
  const out = run('Asia/Shanghai', code('2026-09-29T12:15:00Z', '2026-09-29T12:20:00Z')).split('\n');
  assert.deepEqual(out.map((l) => l.slice(0, 16)), ['2026-09-30 00:15', '2026-09-30 04:15', '2026-09-30 08:15']);
  assert.match(out[0], /上次 20:15）/);
});

test('同一时刻在 America/New_York 的设备上 → 本地 08:15 → 12:15/16:15/20:15', () => {
  const out = run('America/New_York', code('2026-09-29T12:15:00Z', '2026-09-29T12:20:00Z')).split('\n');
  assert.deepEqual(out.map((l) => l.slice(0, 16)), ['2026-09-29 12:15', '2026-09-29 16:15', '2026-09-29 20:15']);
});

test('间隔按真实经过时间：纽约夏令时结束夜（00:30 EDT + 4h = 03:30 EST）', () => {
  const out = run('America/New_York', code('2026-11-01T04:30:00Z', '2026-11-01T04:31:00Z')).split('\n');
  assert.equal(out[0].slice(0, 16), '2026-11-01 03:30');
});

test('UTC 设备：北京 20:15 那一刻在 UTC 是 12:15', () => {
  const out = run('UTC', code('2026-09-29T12:15:00Z', '2026-09-29T12:20:00Z')).split('\n');
  assert.equal(out[0].slice(0, 16), '2026-09-29 16:15');
});
