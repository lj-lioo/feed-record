// 历史：近 7 天小结 + 按天分组的记录（点一条可编辑/删除）
import { store } from '../store.js';
import { esc } from '../ui.js';
import { groupByDay, daySummary, sortDesc, dur, relDay, cnDate, weekday, dayStart, addDaysMs, uid, suggestSide } from '../feeds.js';
import { feedRow } from './home.js';
import { openLogSheet } from './log.js';

export function renderHistory(root) {
  const feeds = store.feeds();
  const now = Date.now();
  const all = sortDesc(feeds);
  const days = groupByDay(feeds).slice(0, 60);
  const week = Array.from({ length: 7 }, (_, i) => daySummary(feeds, addDaysMs(dayStart(now), -i)));
  const maxC = Math.max(1, ...week.map((d) => d.count));
  const withData = week.filter((d) => d.count);
  const avg = withData.length ? (withData.reduce((a, d) => a + d.count, 0) / withData.length).toFixed(1) : 0;
  root.innerHTML = `
    <header class="topbar"><h1>喂奶历史</h1><button class="btn secondary sm" id="btnBackfill">＋ 补记</button></header>
    <section class="card" id="weekCard">
      <div class="card-head"><h2>近 7 天</h2><span class="small muted">${withData.length ? `平均每天 ${avg} 次` : ''}</span></div>
      <div class="bars">${week.map((d) => `
        <div class="bar-row"><span class="bl">${relDay(d.day, now) === '今天' ? '今天' : weekday(d.day)}</span>
          <span class="bt"><i style="width:${(d.count / maxC * 100).toFixed(0)}%"></i></span>
          <span class="bv">${d.count}次${d.total ? ` · ${d.total}分` : ''}</span></div>`).join('')}</div>
    </section>
    ${days.length ? days.map((d) => `
      <section class="card day-card">
        <div class="day-head"><b>${relDay(d.day, now)}${['今天', '昨天', '前天'].includes(relDay(d.day, now)) ? ` · ${cnDate(d.day)}` : ''} ${weekday(d.day)}</b><span>${d.count} 次 · ${d.total} 分钟</span></div>
        <div class="small muted">左 ${d.left} 分 · 右 ${d.right} 分${d.avgGap ? ` · 平均间隔 ${dur(d.avgGap)}` : ''}</div>
        <ul class="feed-list">${d.feeds.map((f) => feedRow(f, all[all.indexOf(f) + 1], now, false)).join('')}</ul>
      </section>`).join('') : '<section class="card"><p class="muted center">还没有记录</p></section>'}
  `;
  root.querySelectorAll('.feed-row').forEach((li) => li.onclick = () => openLogSheet(li.dataset.id));
  root.querySelector('#btnBackfill').onclick = () => {
    // 补记：先按 30 分钟前建一条，面板里改成实际时间；不是最近一次的话不会动闹钟
    const d = new Date(now - 30 * 60000); d.setSeconds(0, 0);
    const f = store.addFeed({ id: uid(), start: d.getTime(), side: suggestSide(feeds).side });
    openLogSheet(f.id, { isNew: true });
  };
}
