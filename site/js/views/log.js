// 记一次喂奶 / 编辑喂奶记录（底部面板）。每次修改立即保存；点「完成」时如果闹钟需要变，就打开快捷指令重设。
import { store } from '../store.js';
import { esc, openSheet, closeSheet, toast } from '../ui.js';
import { suggestSide, whenText, hm, ymd, pad, SIDES, latestFeed } from '../feeds.js';
import { alarmStatus, resetAlarm } from '../alarmctl.js';

const toLocalInput = (ms) => `${ymd(ms)}T${hm(ms)}`;

// 大按钮：一点就记一次（开始时间 = 现在，侧别 = 建议的那边），然后弹出面板补充
export function logFeedNow() {
  const sug = suggestSide(store.feeds());
  const f = store.addFeed({ start: Date.now(), side: sug.side });
  openLogSheet(f.id, { isNew: true, sug });
  return f;
}

export function openLogSheet(id, { isNew = false, sug = null } = {}) {
  let f = store.getFeed(id);
  if (!f) return;
  sug = sug || suggestSide(store.feeds().filter((x) => x.id !== id));
  const agoBtns = [[0, '刚刚'], [5, '5分钟前'], [10, '10分钟前'], [15, '15分钟前'], [20, '20分钟前'], [30, '30分钟前'], [60, '1小时前']];
  openSheet(`
    <h3 id="lg-title">${isNew ? '🍼 已记录，开始喂奶' : '✏️ 编辑喂奶记录'}</h3>
    <div class="field">
      <div class="flabel">开始时间</div>
      <div class="when-big" id="lg-when"></div>
      <div class="quick" id="lg-ago">${agoBtns.map(([m, t]) => `<button type="button" data-m="${m}">${t}</button>`).join('')}</div>
      <input type="datetime-local" id="lg-start" class="input" style="margin-top:8px" aria-label="开始时间">
    </div>
    <div class="field">
      <div class="flabel">喂的哪边 ${sug.reason ? `<span class="hint">建议 ${SIDES[sug.side]}（${esc(sug.reason)}）</span>` : ''}</div>
      <div class="seg big" id="lg-side">
        <button type="button" data-s="L">左</button><button type="button" data-s="R">右</button><button type="button" data-s="B">两边</button>
      </div>
    </div>
    <div class="field" id="lg-mins">
      <div class="flabel">每边几分钟 <span class="hint">可以喂完再填，不影响闹钟</span></div>
      ${[['minL', '左边'], ['minR', '右边']].map(([k, t]) => `
      <div class="min-row" data-k="${k}">
        <span class="mlab">${t}</span>
        <button type="button" class="step" data-d="-5" aria-label="${t}减5分钟">−5</button>
        <input class="input mval" type="number" inputmode="numeric" min="0" max="180" id="lg-${k}" aria-label="${t}分钟">
        <button type="button" class="step" data-d="5" aria-label="${t}加5分钟">+5</button>
        <span class="unit">分</span>
      </div>`).join('')}
    </div>
    <div class="field"><label for="lg-note">备注（可不填）</label><input id="lg-note" class="input" placeholder="例如：吐奶、换了尿布"></div>
    <button class="btn block big" id="lg-done"></button>
    <p class="small muted center" id="lg-alarm"></p>
    <div class="btn-row"><button class="btn ghost" id="lg-del">${isNew ? '撤销这次记录' : '🗑 删除这条记录'}</button></div>
  `, (s) => {
    const q = (sel) => s.querySelector(sel);
    const save = (patch) => { f = store.updateFeed(id, patch) || f; paint(); };
    function paint() {
      q('#lg-when').textContent = whenText(f.start);
      q('#lg-start').value = toLocalInput(f.start);
      s.querySelectorAll('#lg-side button').forEach((b) => b.classList.toggle('on', b.dataset.s === f.side));
      s.querySelector('.min-row[data-k=minL]').hidden = f.side === 'R';
      s.querySelector('.min-row[data-k=minR]').hidden = f.side === 'L';
      for (const k of ['minL', 'minR']) { const i = q(`#lg-${k}`); if (document.activeElement !== i) i.value = f[k] || ''; }
      if (document.activeElement !== q('#lg-note')) q('#lg-note').value = f.note || '';
      const st = alarmStatus();
      const willRun = store.settings.autoShortcut && !st.synced;
      q('#lg-done').textContent = willRun ? '✅ 完成 · 更新闹钟' : '✅ 完成';
      const times = st.plan.lines.map((l) => hm(l.at)).join(' · ');
      q('#lg-alarm').textContent = st.plan.clear ? '没有记录了，会清空「喂奶」列表的闹钟' : (st.synced ? `iPhone 闹钟不用变：${times}` : `iPhone 闹钟将设为：${times}`);
    }
    paint();
    q('#lg-ago').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const d = new Date(Date.now() - (+b.dataset.m) * 60000); d.setSeconds(0, 0);
      save({ start: d.getTime() });
    };
    q('#lg-start').onchange = (e) => {
      const v = e.target.value; if (!v) return;
      const [dt, tm] = v.split('T'); const [y, mo, da] = dt.split('-').map(Number); const [hh, mi] = tm.split(':').map(Number);
      const ms = new Date(y, mo - 1, da, hh, mi).getTime();
      if (ms > Date.now() + 5 * 60000) { toast('开始时间不能晚于现在'); paint(); return; }
      save({ start: ms });
    };
    q('#lg-side').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const side = b.dataset.s;
      const patch = { side };
      if (side === 'L') patch.minR = 0;
      if (side === 'R') patch.minL = 0;
      save(patch);
    };
    s.querySelectorAll('.min-row').forEach((row) => {
      const k = row.dataset.k, inp = row.querySelector('input');
      row.querySelectorAll('.step').forEach((b) => b.onclick = () => save({ [k]: Math.max(0, (f[k] || 0) + (+b.dataset.d)) }));
      inp.oninput = () => save({ [k]: inp.value });
    });
    q('#lg-note').onchange = (e) => save({ note: e.target.value.trim() });
    q('#lg-done').onclick = () => {
      const note = q('#lg-note').value.trim(); if (note !== (f.note || '')) store.updateFeed(id, { note });
      const st = alarmStatus();
      closeSheet();
      if (store.settings.autoShortcut && !st.synced) { resetAlarm(st.plan); toast('正在打开快捷指令重设闹钟…', 3000); }
      else toast(st.synced ? '已保存 ✅' : '已保存。记得点首页的「更新闹钟」', 3500);
    };
    let armed = false;
    q('#lg-del').onclick = () => {
      if (!isNew && !armed) { armed = true; q('#lg-del').textContent = '确定删除？再点一次'; q('#lg-del').className = 'btn danger'; return; }
      const wasLatest = latestFeed(store.feeds())?.id === id;
      store.deleteFeed(id);
      closeSheet();
      const st = alarmStatus();
      if (wasLatest && !st.synced && store.settings.autoShortcut) { resetAlarm(st.plan); toast(st.plan.clear ? '已删除，正在清空闹钟…' : '已删除，正在按上一次喂奶重设闹钟…', 3500); }
      else toast(isNew ? '已撤销' : '已删除');
    };
  });
}
export { pad };
