// 入口：路由、渲染、App 内提醒检查、Service Worker、云同步
import { store } from './store.js';
import { $$, closeSheet } from './ui.js';
import { renderHome } from './views/home.js';
import { renderHistory } from './views/history.js';
import { renderSettings, openPairSheet } from './views/settings.js';
import { renderHelp } from './views/help.js';
import { checkDueAlarms } from './views/alarm.js';
import { unlockAudio } from './sound.js';
import { initSync, syncAvailable, takePendingPairKey } from './sync.js';

const view = document.getElementById('view');
const routes = { home: renderHome, history: renderHistory, settings: renderSettings, help: renderHelp };
const path = () => location.hash.replace(/^#\/?/, '').split('?')[0] || 'home';

function render() {
  const p = routes[path()] ? path() : 'home';
  routes[p](view);
  $$('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === p));
}
window.addEventListener('hashchange', () => { closeSheet(); render(); window.scrollTo(0, 0); });
window.addEventListener('rerender', render);
store.subscribe(() => { if (path() !== 'help') render(); });

document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
setInterval(checkDueAlarms, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); checkDueAlarms(); } });
let lastDay = new Date().getDate();
setInterval(() => { if (new Date().getDate() !== lastDay) { lastDay = new Date().getDate(); render(); } }, 60000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch((e) => console.warn('SW 注册失败', e));
}

render();
setTimeout(checkDueAlarms, 800);
initSync();
const pairKey = takePendingPairKey();
if (pairKey && syncAvailable()) openPairSheet(pairKey);
