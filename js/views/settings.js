// 设置：喂奶间隔、闹钟次数、快捷指令、宝宝资料、云同步、数据备份
import { store } from '../store.js';
import { esc, toast, confirmSheet, openSheet, closeSheet } from '../ui.js';
import { intervalText, clampCount, hm, ymd, MIN_ALARMS, MAX_ALARMS } from '../feeds.js';
import { alarmStatus, resetAlarm, runTestAlarm } from '../alarmctl.js';
import { showAlarm } from './alarm.js';
import { unlockAudio } from '../sound.js';
import { syncAvailable, syncStatus, enableSync, disableSync, syncNow } from '../sync.js';
import { extractSyncKey } from '../sync-core.js';
// 本组 JS 的版本（发布时与 config.js 的 appVersion、sw.js 的 VERSION 一起改）
export const APP_BUILD = '1.1.0';
const PRESETS = [120, 150, 180, 210, 240];

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function renderSettings(root) {
  const st = store.settings;
  const n = clampCount(st.alarmCount);
  const custom = !PRESETS.includes(st.intervalMin);
  root.innerHTML = `
    <header class="topbar"><h1>设置</h1></header>

    <section class="card" id="ivCard">
      <h2>⏱ 喂奶间隔</h2>
      <p class="small muted" style="margin-top:0">从<b>最近一次</b>喂奶的开始时间算起。提前喂了会自动从那次重新算。</p>
      <div class="chips big" id="ivChips">${PRESETS.map((m) => `<button data-m="${m}" class="${st.intervalMin === m ? 'on' : ''}">${intervalText(m)}</button>`).join('')}
        <button data-m="custom" class="${custom ? 'on' : ''}">自定义</button></div>
      <div class="custom-row" id="ivCustom" ${custom ? '' : 'hidden'}>
        <input class="input" type="number" inputmode="numeric" id="ivH" min="0" max="12" value="${Math.floor(st.intervalMin / 60)}" aria-label="小时"> 小时
        <input class="input" type="number" inputmode="numeric" id="ivM" min="0" max="59" step="5" value="${st.intervalMin % 60}" aria-label="分钟"> 分钟
      </div>
    </section>

    <section class="card" id="alarmCard">
      <h2>⏰ iPhone 闹钟（快捷指令）</h2>
      <div class="kv"><span>每次喂奶后连响几次</span>
        <span class="stepper"><button id="cntMinus" aria-label="减少">−</button><b id="cntVal">${n}</b><button id="cntPlus" aria-label="增加">＋</button></span></div>
      <p class="small muted" id="cntHint">上次喂奶后 ${Array.from({ length: n }, (_, i) => intervalText(st.intervalMin * (i + 1))).join('、')} 各响一次；忘了点「喂奶了」，后面的也会响。（${MIN_ALARMS}～${MAX_ALARMS} 次）</p>
      <div class="field"><label for="scName">快捷指令名称（需与「快捷指令」App 里的名称完全一致）</label>
        <input id="scName" class="input" value="${esc(st.shortcutName)}"></div>
      <label class="kv"><span>点「喂奶了」/改时间后自动打开快捷指令重设闹钟</span><input type="checkbox" id="autoSc" ${st.autoShortcut ? 'checked' : ''}></label>
      <button class="btn block" id="btnTestAlarm">测试闹钟（2分钟后响）</button>
      <p class="small muted">会清空「喂奶」列表，新建一条 2 分钟后响的测试提醒，并重建当前的喂奶闹钟。</p>
      <button class="btn secondary block" id="btnResetNow">立即重设 iPhone 闹钟</button>
      <button class="btn secondary block" id="btnPreview" style="margin-top:10px">预览App内全屏提醒（含铃声）</button>
      <label class="kv" style="margin-top:8px"><span>App 内提醒铃声</span><input type="checkbox" id="soundOn" ${st.sound ? 'checked' : ''}></label>
      <p class="small muted"><a href="#/help">怎么创建「${esc(st.shortcutName)}」快捷指令？</a></p>
    </section>

    <section class="card">
      <h2>👶 宝宝</h2>
      <div class="row2">
        <div class="field"><label for="bName">小名（可不填）</label><input id="bName" class="input" value="${esc(st.babyName)}"></div>
        <div class="field"><label for="bBday">生日</label><input id="bBday" class="input" type="date" value="${esc(st.babyBirthday)}"></div>
      </div>
    </section>

    ${syncAvailable() ? syncCardHtml() : ''}

    <section class="card">
      <h2>💾 数据备份</h2>
      <p class="small muted" style="margin-top:0">数据保存在这台手机上（开了云同步也会加密存到云端）。建议定期导出。</p>
      <div class="btn-row"><button class="btn secondary" id="btnExport">导出 JSON</button><button class="btn secondary" id="btnImport">导入 JSON</button></div>
      <input type="file" id="fileImport" accept="application/json,.json" hidden>
      <button class="btn danger block" id="btnReset" style="margin-top:10px">清空所有数据</button>
      <p class="small muted center" id="appVer">喂奶记录 v${esc(APP_BUILD)}${(window.FEED_CONFIG?.appVersion || APP_BUILD) !== APP_BUILD ? ` · 正在更新到 v${esc(window.FEED_CONFIG.appVersion)}，请关闭后重新打开` : ''}</p>
    </section>`;

  const q = (s) => root.querySelector(s);
  q('#ivChips').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.m === 'custom') { q('#ivCustom').hidden = false; root.querySelectorAll('#ivChips button').forEach((x) => x.classList.toggle('on', x === b)); return; }
    store.updateSettings({ intervalMin: +b.dataset.m });
    toast(`间隔已改为 ${intervalText(+b.dataset.m)}${alarmStatus().synced ? '' : '，记得重设闹钟'}`, 3000);
  };
  const saveCustom = () => {
    const m = (+q('#ivH').value || 0) * 60 + (+q('#ivM').value || 0);
    if (m < 30) { toast('间隔至少 30 分钟'); return; }
    store.updateSettings({ intervalMin: m });
    toast(`间隔已改为 ${intervalText(store.settings.intervalMin)}`);
  };
  q('#ivH').onchange = saveCustom; q('#ivM').onchange = saveCustom;
  q('#cntMinus').onclick = () => store.updateSettings({ alarmCount: clampCount(store.settings.alarmCount - 1) });
  q('#cntPlus').onclick = () => store.updateSettings({ alarmCount: clampCount(store.settings.alarmCount + 1) });
  q('#scName').onchange = (e) => { store.updateSettings({ shortcutName: e.target.value.trim() || '喂奶闹钟' }); toast('已保存'); };
  q('#autoSc').onchange = (e) => store.updateSettings({ autoShortcut: e.target.checked });
  q('#soundOn').onchange = (e) => store.updateSettings({ sound: e.target.checked });
  q('#bName').onchange = (e) => store.updateSettings({ babyName: e.target.value.trim() });
  q('#bBday').onchange = (e) => store.updateSettings({ babyBirthday: e.target.value });
  q('#btnTestAlarm').onclick = () => runTestAlarm();
  q('#btnResetNow').onclick = () => resetAlarm();
  q('#btnPreview').onclick = () => { unlockAudio(); showAlarm({ key: `demo-${Date.now()}`, at: Date.now(), k: 1, demo: true }); };

  if (syncAvailable()) bindSyncCard(root);

  q('#btnExport').onclick = () => exportBackup();
  q('#btnImport').onclick = () => q('#fileImport').click();
  q('#fileImport').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text();
    e.target.value = '';
    const ok = await confirmSheet('导入会用备份文件替换当前所有喂奶记录，确定吗？', '导入');
    if (!ok) return;
    try { const k = store.importJSON(text); toast(`导入成功，共 ${k} 条记录${alarmStatus().synced ? '' : '。请回首页点「更新闹钟」'}`, 4000); } catch (err) { toast('导入失败：' + err.message, 4000); }
  };
  q('#btnReset').onclick = async () => {
    const ok = await confirmSheet('确定清空所有喂奶记录和设置吗？此操作不可恢复（建议先导出备份）。', '清空', true);
    if (ok) { store.resetAll(); toast('已清空。iPhone 上的闹钟请回首页点「更新闹钟」清掉', 4000); }
  };
}

// ===== 云同步 =====
function fmtTime(t) {
  if (!t) return '还没有同步过';
  const d = new Date(t), p = (x) => String(x).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function syncStateHtml(s = syncStatus()) {
  if (!s.enabled) return '<span class="muted">未开启</span>';
  if (s.running) return '同步中…';
  if (s.lastError) return `<span class="bad">同步失败：${esc(s.lastError)}</span>`;
  return `<span class="ok">已开启</span> · 上次同步 ${esc(fmtTime(s.lastSyncAt))}`;
}
function syncCardHtml() {
  const s = syncStatus();
  return `<section class="card" id="syncCard">
      <h2>☁️ 云同步（可选）</h2>
      <p class="small muted" style="margin-top:0">多台手机共用喂奶记录；助手也能在聊天里帮你记一次。数据在本机<b>加密</b>后上传，和「宝宝记录」的数据完全分开（密钥以 <b>frs1_</b> 开头）。</p>
      <div class="kv"><span>状态</span><span id="syncState">${syncStateHtml(s)}</span></div>
      ${s.enabled ? `
      <div class="field" style="margin-top:8px"><label>同步密钥</label>
        <input id="syncKey" class="input" readonly value="${esc(s.key.slice(0, 9) + '••••••••••••' + s.key.slice(-4))}" data-full="${esc(s.key)}"></div>
      <div class="btn-row"><button class="btn secondary" id="btnSyncShow">显示</button><button class="btn secondary" id="btnSyncCopy">复制密钥</button></div>
      <div class="btn-row" style="margin-top:10px"><button class="btn" id="btnSyncNow">立即同步</button><button class="btn ghost" id="btnSyncOff">关闭同步</button></div>
      <p class="note small">⚠️ 拿到密钥的人可以读写你的喂奶记录，只在自己的设备之间传递。别处（助手/另一台手机）记的喂奶不会自动改这台 iPhone 的闹钟，首页会提示你点「更新闹钟」。</p>` : `
      <div class="field" style="margin-top:8px"><label for="syncPaste">同步密钥（以 frs1_ 开头）</label>
        <textarea id="syncPaste" class="input" rows="2" placeholder="粘贴同步密钥"></textarea></div>
      <div class="btn-row"><button class="btn secondary" id="btnSyncClip">从剪贴板粘贴</button><button class="btn" id="btnSyncJoin">连接并同步</button></div>
      <p class="small muted">本机已有的记录会上传并和云端合并，不会被清空。国内网络可能需要 VPN（workers.dev 在大陆被屏蔽）。</p>
      <details style="margin-top:6px"><summary class="small">没有密钥？在这台设备上生成新密钥</summary>
        <button class="btn secondary block" id="btnSyncOn" style="margin-top:8px">生成新密钥并开启</button>
      </details>`}
    </section>`;
}
function bindSyncCard(root) {
  const q = (s) => root.querySelector(s);
  const run = async (btn, fn, okMsg) => {
    btn.disabled = true;
    try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.message, 4000); }
    btn.disabled = false;
    renderSettings(root);
  };
  q('#btnSyncOn') && (q('#btnSyncOn').onclick = () => run(q('#btnSyncOn'), () => enableSync(), '云同步已开启 ☁️'));
  q('#btnSyncJoin') && (q('#btnSyncJoin').onclick = () => run(q('#btnSyncJoin'), () => enableSync(q('#syncPaste').value), '已连接，数据已合并 ☁️'));
  q('#btnSyncClip') && (q('#btnSyncClip').onclick = async () => {
    try {
      const k = extractSyncKey(await navigator.clipboard.readText());
      if (!k) { toast('剪贴板里没有同步密钥（应以 frs1_ 开头）', 3500); return; }
      q('#syncPaste').value = k; toast('已粘贴，点「连接并同步」');
    } catch { toast('无法读取剪贴板：请长按输入框选择「粘贴」', 3500); q('#syncPaste').focus(); }
  });
  q('#btnSyncNow') && (q('#btnSyncNow').onclick = () => run(q('#btnSyncNow'), async () => { await syncNow('manual'); if (syncStatus().lastError) throw new Error('同步失败：' + syncStatus().lastError); }, '已同步'));
  q('#btnSyncOff') && (q('#btnSyncOff').onclick = async () => {
    if (await confirmSheet('关闭后这台设备不再同步（本机数据和密钥都保留）。', '关闭同步')) { disableSync(); renderSettings(root); }
  });
  q('#btnSyncShow') && (q('#btnSyncShow').onclick = () => { const i = q('#syncKey'); i.value = i.dataset.full; i.select(); });
  q('#btnSyncCopy') && (q('#btnSyncCopy').onclick = async () => {
    const i = q('#syncKey');
    try { await navigator.clipboard.writeText(i.dataset.full); toast('已复制同步密钥'); } catch { i.value = i.dataset.full; i.select(); toast('请长按选择并复制'); }
  });
}
// 打开配对链接（#pair=密钥）后
export function openPairSheet(key) {
  const inApp = isStandalone();
  const fp = `${key.slice(0, 9)}…${key.slice(-4)}`;
  openSheet(`
    <h3>☁️ 连接云同步</h3>
    ${inApp || !isIOS() ? `<p>用这个同步密钥（${esc(fp)}）和其他设备、助手共享喂奶记录。</p>
      <div class="btn-row"><button class="btn ghost" id="pairCancel">取消</button><button class="btn" id="pairJoin">连接并同步</button></div>
      ${inApp ? '' : '<button class="btn secondary block" id="pairCopy" style="margin-top:10px">复制同步密钥</button>'}`
    : `<p>你现在是在 <b>Safari</b> 里打开的。主屏幕上的「喂奶记录」App 和 Safari 的数据是分开的：</p>
      <ol class="small" style="padding-left:20px;line-height:1.8"><li>点「复制同步密钥」</li><li>回主屏幕打开「喂奶记录」</li><li>设置 → ☁️ 云同步 →「从剪贴板粘贴」→「连接并同步」</li></ol>
      <button class="btn block" id="pairCopy">复制同步密钥</button>
      <div class="btn-row" style="margin-top:10px"><button class="btn ghost" id="pairCancel">关闭</button><button class="btn secondary" id="pairJoin">就在 Safari 里使用</button></div>`}
  `, (sh) => {
    sh.querySelector('#pairCancel').onclick = closeSheet;
    const copy = sh.querySelector('#pairCopy');
    if (copy) copy.onclick = async () => { try { await navigator.clipboard.writeText(key); toast('已复制', 2500); } catch { toast('复制失败，请重新扫码', 3500); } };
    sh.querySelector('#pairJoin').onclick = async () => {
      closeSheet();
      try { await enableSync(key); toast('已连接，数据已合并 ☁️'); } catch (e) { toast(e.message, 4000); }
      window.dispatchEvent(new CustomEvent('rerender'));
    };
  });
}
window.addEventListener('sync-status', (e) => { const el = document.getElementById('syncState'); if (el) el.innerHTML = syncStateHtml(e.detail); });

async function exportBackup() {
  const json = store.exportJSON();
  const name = `喂奶记录备份-${ymd(Date.now()).replace(/-/g, '')}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && isIOS()) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  toast('备份文件已导出');
}
export { hm };
