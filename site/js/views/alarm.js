// App 打开时的全屏「该喂奶了」提醒（备用：主力是 iPhone 提醒事项的紧急闹钟）
import { store } from '../store.js';
import { esc, toast } from '../ui.js';
import { latestFeed, alarmSlots, suggestSide, hm, dur, whenText, SIDES, sideText, intervalText, pad } from '../feeds.js';
import { startAlarmSound, stopAlarmSound, unlockAudio } from '../sound.js';
import { logFeedNow } from './log.js';

let current = null, clockTimer = null;
export const alarmShowing = () => !!current;
const WINDOW = 30 * 60000;   // 到点后 30 分钟内打开 App 也会弹

export function dueAlarm(now = Date.now()) {
  const s = store.settings, feeds = store.feeds();
  const last = latestFeed(feeds);
  if (!last) return null;
  const due = alarmSlots(feeds, s.intervalMin, s.alarmCount).filter((x) => x.at <= now && now - x.at < WINDOW && !store.isFired(`${last.id}:${x.at}`)).pop();
  if (due) return { key: `${last.id}:${due.at}`, at: due.at, k: due.k };
  const sn = store.state.snooze;
  if (sn && sn.at <= now && now - sn.at < WINDOW && !store.isFired(sn.key) && sn.feedId === last.id) return { key: sn.key, at: sn.at, k: sn.k, snoozed: true };
  return null;
}

export function showAlarm({ key, at, k, snoozed = false, demo = false }) {
  if (current && current.key === key) return;
  const feeds = store.feeds(), last = latestFeed(feeds), s = store.settings;
  const sug = suggestSide(feeds);
  current = { key };
  const el = document.getElementById('alarm');
  el.innerHTML = `
    <div class="a-top">喂奶提醒${demo ? '（预览）' : ''}</div>
    <div class="bell">🍼</div>
    <div class="a-clock" id="aClock"></div>
    <div class="a-title">该喂奶了</div>
    <div class="a-when">${last ? `上次 ${esc(whenText(last.start))}${last.side ? ' ' + SIDES[last.side] : ''} · 已过 ${esc(dur(Date.now() - last.start))}` : ''}</div>
    <div class="a-why">
      <div class="lab">为什么现在提醒你</div>
      <div class="val">${snoozed ? '你刚才点了「稍后提醒」' : `距上次喂奶满 ${esc(intervalText(s.intervalMin * (k || 1)))}（第${k || 1}次提醒）`}</div>
      <div class="lab" style="margin-top:8px">建议这次先喂</div>
      <div class="val">${SIDES[sug.side]}${sug.reason ? `（${esc(sug.reason)}）` : ''}</div>
    </div>
    <div class="sound-hint" id="aSound"></div>
    <div class="a-actions">
      <button class="btn block big" id="aFeed">🍼 开始喂奶（记录一次）</button>
      <button class="btn secondary block" id="aSnooze">稍后提醒（10分钟）</button>
      <button class="btn ghost block" id="aOk">知道了</button>
    </div>`;
  el.hidden = false;
  document.body.style.overflow = 'hidden';
  const tickFn = () => { const d = new Date(); el.querySelector('#aClock').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  tickFn(); clockTimer = setInterval(tickFn, 10000);
  if (s.sound) {
    if (!startAlarmSound()) {
      const hint = el.querySelector('#aSound');
      hint.innerHTML = '<button class="chip-btn">🔊 点此播放提醒铃声</button>';
      hint.querySelector('button').onclick = () => { unlockAudio(); startAlarmSound(); hint.innerHTML = ''; };
    }
  }
  const fire = () => { if (!demo) store.markFired(key); };
  el.querySelector('#aOk').onclick = () => { fire(); closeAlarm(); };
  el.querySelector('#aFeed').onclick = () => { fire(); closeAlarm(); if (!demo) logFeedNow(); };
  el.querySelector('#aSnooze').onclick = () => {
    fire();
    if (!demo && last) store.setSnooze({ at: Date.now() + 10 * 60000, key: `snz-${Date.now()}`, feedId: last.id, k });
    closeAlarm();
    toast('好的，10分钟后在App里再提醒（iPhone 闹钟不受影响）', 3500);
  };
}
export function closeAlarm() {
  stopAlarmSound();
  clearInterval(clockTimer);
  current = null;
  const el = document.getElementById('alarm');
  el.hidden = true; el.innerHTML = '';
  document.body.style.overflow = '';
}
export function checkDueAlarms() {
  if (current) return;
  const d = dueAlarm();
  if (d) showAlarm(d);
}
