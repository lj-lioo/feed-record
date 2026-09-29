// 记录喂奶：大按钮一点 = 记下现在的时间并立即打开快捷指令重设闹钟；
// 「补记 / 改时间」面板只调整时间（晚记了、记错了），保存后如闹钟需要变就打开快捷指令。
import { store } from '../store.js';
import { openSheet, closeSheet, toast, confirmSheet } from '../ui.js';
import { whenText, hm, ymd, latestFeed } from '../feeds.js';
import { alarmStatus, resetAlarm } from '../alarmctl.js';

const toLocalInput = (ms) => `${ymd(ms)}T${hm(ms)}`;
const minuteFloor = (ms) => { const d = new Date(ms); d.setSeconds(0, 0); return d.getTime(); };

// 保存后：闹钟需要变就打开快捷指令（必须在点击事件里同步调用）
function afterChange(okMsg) {
  const st = alarmStatus();
  if (store.settings.autoShortcut && !st.synced) { resetAlarm(st.plan); toast(st.plan.clear ? `${okMsg}，正在清空闹钟…` : `${okMsg}，正在打开快捷指令重设闹钟…`, 3000); return true; }
  toast(st.synced ? okMsg : `${okMsg}。记得点首页的「更新闹钟」`, 3000);
  return false;
}

// 大按钮
export function logFeedNow({ confirmRecent = true } = {}) {
  const last = latestFeed(store.feeds());
  if (confirmRecent && last && Date.now() - last.start < 3 * 60000 && Date.now() >= last.start) {
    // 防止夜里误点两次
    openSheet(`<h3>刚刚 ${hm(last.start)} 已经记录过一次</h3><p class="muted">还要再记一次吗？</p>
      <div class="btn-row"><button class="btn ghost" id="dupNo">不用了</button><button class="btn" id="dupYes">再记一次</button></div>`, (s) => {
      s.querySelector('#dupNo').onclick = closeSheet;
      s.querySelector('#dupYes').onclick = () => { closeSheet(); logFeedNow({ confirmRecent: false }); };
    });
    return null;
  }
  const f = store.addFeed({ start: minuteFloor(Date.now()) });
  afterChange(`已记录 ${hm(f.start)} 喂奶`);
  return f;
}

// 撤销刚记的一次（首页「撤销」）
export function undoFeed(id) {
  store.deleteFeed(id);
  afterChange('已撤销');
}

// 补记（id 为空）/ 改时间 / 删除
export function openTimeSheet(id = null) {
  const f = id ? store.getFeed(id) : null;
  if (id && !f) return;
  let start = f ? f.start : minuteFloor(Date.now() - 20 * 60000);
  const agoBtns = [[5, '5分钟前'], [10, '10分钟前'], [15, '15分钟前'], [20, '20分钟前'], [30, '30分钟前'], [45, '45分钟前'], [60, '1小时前'], [90, '1.5小时前']];
  openSheet(`
    <h3 id="lg-title">${f ? '✏️ 改喂奶时间' : '🕒 补记一次喂奶'}</h3>
    <div class="field">
      <div class="flabel">${f ? `原来记的是 ${whenText(f.start)}，改成：` : '什么时候喂的？'}</div>
      <div class="when-big" id="lg-when"></div>
      <div class="quick" id="lg-ago">${agoBtns.map(([m, t]) => `<button type="button" data-m="${m}">${t}</button>`).join('')}</div>
      <input type="datetime-local" id="lg-start" class="input" style="margin-top:10px" aria-label="喂奶时间">
    </div>
    <button class="btn block big" id="lg-done">保存</button>
    <p class="small muted center" id="lg-alarm"></p>
    ${f ? '<div class="btn-row"><button class="btn ghost" id="lg-del">🗑 删除这条记录</button></div>' : '<div class="btn-row"><button class="btn ghost" id="lg-cancel">取消</button></div>'}
  `, (s) => {
    const q = (sel) => s.querySelector(sel);
    const preview = () => {
      const feeds = f ? store.feeds().map((x) => (x.id === f.id ? { ...x, start } : x)) : [...store.feeds(), { id: '__new__', start }];
      const willBeLatest = latestFeed(feeds).start === start;
      const next = latestFeed(feeds).start + store.settings.intervalMin * 60000;
      const changed = !f || start !== f.start;
      q('#lg-alarm').textContent = willBeLatest ? `保存后闹钟从 ${hm(start)} 算起：下次 ${whenText(next)}` : '这不是最近一次，闹钟不用变';
      q('#lg-done').textContent = willBeLatest && changed && store.settings.autoShortcut ? '保存 · 更新闹钟' : '保存';
    };
    function paint() {
      q('#lg-when').textContent = whenText(start);
      q('#lg-start').value = toLocalInput(start);
      preview();
    }
    paint();
    q('#lg-ago').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      start = minuteFloor(Date.now() - (+b.dataset.m) * 60000); paint();
    };
    q('#lg-start').onchange = (e) => {
      const v = e.target.value; if (!v) return;
      const [dt, tm] = v.split('T'); const [y, mo, da] = dt.split('-').map(Number); const [hh, mi] = tm.split(':').map(Number);
      const ms = new Date(y, mo - 1, da, hh, mi).getTime();
      if (ms > Date.now() + 60000) { toast('喂奶时间不能晚于现在'); paint(); return; }
      start = ms; paint();
    };
    q('#lg-done').onclick = () => {
      if (start > Date.now() + 60000) { toast('喂奶时间不能晚于现在'); return; }
      closeSheet();
      if (f) { if (start === f.start) { toast('时间没有变'); return; } store.updateFeed(f.id, { start }); afterChange(`已改为 ${hm(start)}`); }
      else { store.addFeed({ start }); afterChange(`已补记 ${whenText(start)}`); }
    };
    if (q('#lg-cancel')) q('#lg-cancel').onclick = closeSheet;
    let armed = false;
    if (q('#lg-del')) q('#lg-del').onclick = () => {
      if (!armed) { armed = true; q('#lg-del').textContent = '确定删除？再点一次'; q('#lg-del').className = 'btn danger'; return; }
      closeSheet();
      store.deleteFeed(f.id);
      afterChange('已删除');
    };
  });
}
export { confirmSheet };
