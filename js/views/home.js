// 首页：距上次喂奶（实时）、下次喂奶时间与倒计时、iPhone 闹钟状态、大按钮「🍼 喂奶了」（一点就记录并重设闹钟）、补记/改时间、今天次数、最近记录
import { store } from '../store.js';
import { esc } from '../ui.js';
import { latestFeed, daySummary, dur, hm, whenText, relDay, cnDate, weekday, babyAgeDays, sortDesc, intervalText, pad } from '../feeds.js';
import { alarmStatus, resetAlarm } from '../alarmctl.js';
import { logFeedNow, openTimeSheet, undoFeed } from './log.js';

let tick = null;

export function renderHome(root) {
  const s = store.settings;
  const feeds = store.feeds();
  const last = latestFeed(feeds);
  const now = Date.now();
  const age = babyAgeDays(s.babyBirthday, now);
  const today = daySummary(feeds, now);
  const st = alarmStatus(now);
  const recent = sortDesc(feeds).slice(0, 4);
  const times = (arr) => arr.map((t) => `<b>${hm(t)}</b>${relDay(t, now) !== '今天' ? `<small>${relDay(t, now)}</small>` : ''}`).join('<span class="sep">·</span>');

  let alarmHtml = '';
  if (!st.synced) {
    alarmHtml = `<section class="alarm-warn" id="alarmWarn">
      <div><b>⚠️ iPhone 闹钟还没更新</b>
      <div class="small">${st.plan.clear ? '记录已全部删除，需要清空「喂奶」列表里的闹钟' : `应响铃：${times(st.plan.lines.map((l) => l.at))}`}</div></div>
      <button class="btn" id="btnReset">更新闹钟</button></section>`;
  } else if (last && st.sent.times?.length) {
    const up = st.sent.times.filter((t) => t > now - 60000);
    alarmHtml = `<section class="alarm-ok" id="alarmOk">⏰ iPhone 闹钟${up.length ? `：${times(up)}` : '：都已响过，喂奶后点上面的大按钮'}</section>`;
  } else if (!last) {
    alarmHtml = `<section class="alarm-ok muted" id="alarmOk">第一次用？先按 <a href="#/help">使用帮助</a> 设置一次「${esc(s.shortcutName)}」快捷指令</section>`;
  }

  root.innerHTML = `
    <header class="topbar">
      <div class="logo"><img src="icons/icon-192.png" alt=""><div><h1>喂奶记录</h1>
      <div class="sub">${age && age > 0 ? `宝宝第 ${age} 天 · ` : ''}${cnDate(now)} ${weekday(now)}</div></div></div>
      <a class="icon-btn" href="#/settings" aria-label="设置">⚙️</a>
    </header>

    <section class="card status-card" id="statusCard">
      ${last ? `
      <div class="st-label">距上次喂奶</div>
      <div class="st-big" id="sinceLast"></div>
      <div class="st-sub">上次 ${esc(whenText(last.start, now))}</div>
      <div class="st-grid">
        <div><div class="st-label">下次喂奶</div><div class="st-time" id="nextTime"></div><div class="st-day" id="nextDay"></div></div>
        <div><div class="st-label" id="cdLabel">倒计时</div><div class="st-time" id="countdown"></div><div class="st-day">每 ${esc(intervalText(s.intervalMin))}</div></div>
      </div>
      <div class="progress" aria-hidden="true"><i id="progress"></i></div>` : `
      <div class="empty"><div class="big-emoji">🌙</div>还没有喂奶记录<br><span class="small">喂奶时点下面的大按钮，${esc(intervalText(s.intervalMin))}后提醒你</span></div>`}
    </section>

    ${alarmHtml}

    <button class="feed-btn" id="feedBtn"><span class="fb-main">🍼 喂奶了</span><span class="fb-sub">记下现在的时间，${store.settings.autoShortcut ? '并重设 iPhone 闹钟' : `${esc(intervalText(s.intervalMin))}后提醒`}</span></button>
    ${last && last.source !== 'box-cli' && now - last.createdAt < 5 * 60000 && now - last.start < 10 * 60000 ? `<div class="just-logged" id="justLogged">✅ 刚刚记录了 <b>${hm(last.start)}</b><button class="link-btn" id="btnUndo">撤销</button></div>` : ''}
    <div class="sub-actions">
      <button class="chip-btn" id="btnFix" ${last ? '' : 'disabled'}>✏️ 改上次时间</button>
      <button class="chip-btn" id="btnBackfill">🕒 补记一次</button>
    </div>

    <section class="card today-card" id="todayCard">
      <div class="today-grid">
        <div><div class="num" id="todayCount">${today.count}</div><div class="lab">今天次数</div></div>
        <div><div class="num small-num" id="todayGap">${today.avgGap ? esc(dur(today.avgGap)) : '—'}</div><div class="lab">今天平均间隔</div></div>
      </div>
    </section>

    ${recent.length ? `<section class="card">
      <div class="card-head"><h2>最近记录</h2><a href="#/history" class="link-btn">全部 ›</a></div>
      <ul class="feed-list">${recent.map((f, i) => feedRow(f, sortDesc(feeds)[i + 1], now)).join('')}</ul>
    </section>` : ''}
  `;

  root.querySelector('#feedBtn').onclick = () => logFeedNow();
  root.querySelector('#btnBackfill').onclick = () => openTimeSheet();
  if (last) root.querySelector('#btnFix').onclick = () => openTimeSheet(last.id);
  const ub = root.querySelector('#btnUndo');
  if (ub) ub.onclick = () => undoFeed(last.id);
  const rb = root.querySelector('#btnReset');
  if (rb) rb.onclick = () => resetAlarm();
  root.querySelectorAll('.feed-row').forEach((li) => li.onclick = () => openTimeSheet(li.dataset.id));

  clearInterval(tick);
  if (last) {
    const update = () => {
      if (!document.getElementById('sinceLast')) { clearInterval(tick); return; }
      const n = Date.now();
      const iv = s.intervalMin * 60000, next = last.start + iv, left = next - n;
      document.getElementById('sinceLast').textContent = dur(n - last.start);
      document.getElementById('nextTime').textContent = hm(next);
      document.getElementById('nextDay').textContent = relDay(next, n);
      const cd = document.getElementById('countdown');
      const a = Math.abs(left), h = Math.floor(a / 3600000), m = Math.floor((a % 3600000) / 60000), sec = Math.floor((a % 60000) / 1000);
      cd.textContent = `${left < 0 ? '+' : ''}${h}:${pad(m)}:${pad(sec)}`;
      document.getElementById('cdLabel').textContent = left < 0 ? '已超时' : '倒计时';
      document.getElementById('statusCard').classList.toggle('overdue', left < 0);
      document.getElementById('statusCard').classList.toggle('soon', left >= 0 && left < 30 * 60000);
      document.getElementById('progress').style.width = `${Math.min(100, Math.max(0, (n - last.start) / iv * 100)).toFixed(1)}%`;
    };
    update();
    tick = setInterval(update, 1000);
  }
}

export function feedRow(f, prev, now = Date.now(), withDay = true) {
  return `<li class="feed-row" data-id="${esc(f.id)}">
    <span class="fr-time">${hm(f.start)}${withDay && relDay(f.start, now) !== '今天' ? `<small>${relDay(f.start, now)}</small>` : ''}</span>
    <span class="fr-detail">${prev ? `距上一次 <b>${dur(f.start - prev.start)}</b>` : '<span class="muted">第一条记录</span>'}${f.source === 'box-cli' ? '<small>来自助手</small>' : ''}</span>
    <span class="fr-edit" aria-hidden="true">✏️</span>
  </li>`;
}
