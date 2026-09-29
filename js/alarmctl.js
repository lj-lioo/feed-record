// 闹钟控制：当前应设的闹钟、是否已交给快捷指令、打开快捷指令重设
import { store } from './store.js';
import { alarmPlan, payloadText, runShortcutUrl, testPayload } from './shortcuts.js';

export function currentPlan(now = Date.now()) {
  const s = store.settings;
  return alarmPlan({ feeds: store.feeds(), intervalMin: s.intervalMin, count: s.alarmCount, now });
}
// synced = iPhone 上的闹钟（最近一次交给快捷指令的）与当前记录一致
export function alarmStatus(now = Date.now()) {
  const plan = currentPlan(now);
  const sent = store.state.alarm || {};
  const synced = plan.sig === sent.sig || (plan.clear && !sent.sig);
  return { plan, sent, synced };
}
function go(url) {
  window.__lastShortcutUrl = url;            // 测试用
  if (window.__FEED_TEST__) return;           // Playwright 测试里不真的跳转
  location.href = url;
}
// 必须在用户点击的同一个事件里调用（iOS 才允许打开「快捷指令」）
export function resetAlarm(plan = currentPlan()) {
  const url = runShortcutUrl(store.settings.shortcutName, payloadText(plan));
  store.markAlarmSent(plan);
  go(url);
  return url;
}
export function runTestAlarm() {
  const plan = currentPlan();
  const url = runShortcutUrl(store.settings.shortcutName, testPayload(plan));
  store.markAlarmSent(plan);   // 测试会清空列表后连同真实闹钟一起重建
  go(url);
  return url;
}
