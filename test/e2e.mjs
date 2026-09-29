// 端到端测试（Playwright，iPhone 尺寸 390×844，zh-CN，Asia/Shanghai）：
// 一点记录并立即打开快捷指令（3 个闹钟）→ 误点确认 → 提前喂奶重置 → 改时间（首页/历史）→ 补记 → 删除 → CLEAR → 撤销 → 设置（间隔/次数）→ App 内全屏提醒 → 跨午夜 → 导出/导入（含 v1.0 旧备份）→ 截图（浅色/深色）
// 运行：node test/e2e.mjs（BASE=… 可指定地址，默认 http://127.0.0.1:8092/）
import { chromium } from 'playwright';
import fs from 'fs';
const BASE = process.env.BASE || 'http://127.0.0.1:8092/';
const SHOTS = new URL('../screenshots/', import.meta.url).pathname;
const SHOT = process.env.SHOTS !== '0';
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(cond ? '✅' : '❌', name, cond ? '' : extra); };
const T = (s) => new Date(`${s}+08:00`);   // 北京时间

const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/google/chrome/chrome') ? '/opt/google/chrome/chrome' : undefined });
const mk = async (scheme = 'light') => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', colorScheme: scheme,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Mobile/15E148 Safari/604.1', acceptDownloads: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { window.__FEED_TEST__ = true; });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) page.errors.push(m.text()); });
  return { ctx, page };
};
const lastUrl = (page) => page.evaluate(() => window.__lastShortcutUrl || '');
const payload = async (page) => { const u = await lastUrl(page); return u ? new URL(u.replace('shortcuts://', 'https://x/')).searchParams.get('text') : ''; };
const clearUrl = (page) => page.evaluate(() => { window.__lastShortcutUrl = ''; });
const times = (text) => text.split('\n').map((l) => l.slice(0, 16));

// ================= 功能 =================
{
  const { ctx, page } = await mk();
  await page.clock.install({ time: T('2026-09-29T20:15:00') });
  await page.goto(BASE);
  await page.waitForSelector('#feedBtn');
  ok('首页：没有记录时显示空状态和大按钮', (await page.locator('#statusCard').innerText()).includes('还没有喂奶记录') && await page.locator('#feedBtn').isVisible());
  const box = await page.locator('#feedBtn').boundingBox();
  ok('大按钮足够大（≥ 100px 高、占满宽度）', box.height >= 100 && box.width >= 340, JSON.stringify(box));
  ok('宝宝第13天（生日 2026-09-17）', (await page.locator('.topbar .sub').innerText()).includes('第 13 天'));

  const count = () => page.evaluate(() => JSON.parse(localStorage.getItem('feedrecord.v1')).feeds.length);
  const sheetOpen = () => page.evaluate(() => { const s = document.querySelector('.sheet'); return !!s && !s.hidden && s.offsetParent !== null && s.innerHTML.trim() !== ''; });
  ok('首页没有左右/分钟之类的选项', !/左边|右边|两边|分钟数/.test(await page.locator('#app').innerText()));

  // 1) 一点就记录 + 立即打开快捷指令（不弹面板）
  await page.click('#feedBtn');
  await page.waitForTimeout(200);
  ok('点「喂奶了」立即保存一条（开始时间 = 现在 20:15）', (await count()) === 1 && (await page.evaluate(() => JSON.parse(localStorage.getItem('feedrecord.v1')).feeds[0].start)) === T('2026-09-29T20:15:00').getTime());
  ok('不弹出任何面板（没有左右/分钟）', !(await sheetOpen()) && await page.locator('#lg-side, #lg-minL, #lg-done').count() === 0);
  let text = await payload(page);
  ok('同一次点击里就打开快捷指令：run-shortcut?name=喂奶闹钟&input=text', (await lastUrl(page)).startsWith('shortcuts://run-shortcut?name=%E5%96%82%E5%A5%B6%E9%97%B9%E9%92%9F&input=text&text='));
  ok('传入 3 行：00:15 / 04:15 / 08:15（跨午夜到 9月30日）', JSON.stringify(times(text)) === JSON.stringify(['2026-09-30 00:15', '2026-09-30 04:15', '2026-09-30 08:15']), text);
  ok('第1行完整格式：时间|标题|备注（无侧别/分钟）', text.split('\n')[0] === '2026-09-30 00:15|🍼 该喂奶了（第1次 · 上次 20:15）|喂奶记录 · 上次 9月29日 20:15 · 间隔4小时 · 第1次提醒（共3次）', text);
  ok('标题：🍼 该喂奶了（第2次 · 上次 20:15）', text.split('\n')[1].split('|')[1] === '🍼 该喂奶了（第2次 · 上次 20:15）', text);
  await page.waitForTimeout(300);
  ok('首页显示 iPhone 闹钟时间', /00:15.*04:15.*08:15/s.test(await page.locator('#alarmOk').innerText()));
  ok('首页：下次喂奶 00:15（明天）', (await page.locator('#nextTime').innerText()) === '00:15' && (await page.locator('#nextDay').innerText()) === '明天');
  ok('首页：「✅ 刚刚记录了 20:15 · 撤销」', /刚刚记录了\s*20:15/.test(await page.locator('#justLogged').innerText()) && await page.locator('#btnUndo').isVisible());
  ok('状态卡只显示「上次 今天 20:15」', (await page.locator('.st-sub').innerText()) === '上次 今天 20:15');

  // 2) 误点两次：3 分钟内再点先确认
  await clearUrl(page);
  await page.click('#feedBtn');
  await page.waitForSelector('#dupNo');
  ok('3 分钟内又点一次 → 先问「还要再记一次吗」，不记录、不打开快捷指令', (await count()) === 1 && (await lastUrl(page)) === '');
  await page.click('#dupNo');

  // 3) 提前喂奶（2 小时后）
  await page.clock.fastForward('02:00:00');
  await page.waitForTimeout(1200);
  ok('2 小时后：距上次 2小时、倒计时 1:59:xx', (await page.locator('#sinceLast').innerText()).startsWith('2小时') && (await page.locator('#countdown').innerText()).startsWith('1:59') || (await page.locator('#countdown').innerText()).startsWith('2:00'), await page.locator('#countdown').innerText());
  await page.click('#feedBtn');
  text = await payload(page);
  ok('提前喂奶 → 闹钟从这次重新算：02:15 / 06:15 / 10:15', JSON.stringify(times(text)) === JSON.stringify(['2026-09-30 02:15', '2026-09-30 06:15', '2026-09-30 10:15']), text);
  ok('旧的 00:15 不再出现（快捷指令会先删掉旧提醒）', !text.includes('00:15|') && text.includes('上次 22:15）'));

  // 4) 改上次时间（晚记了）：首页「✏️ 改上次时间」→ 10分钟前 → 重设
  await page.waitForTimeout(3300);   // 等提示条消失再截图
  await page.click('#btnFix');
  await page.waitForSelector('#lg-done');
  ok('时间没改时按钮只写「保存」', (await page.locator('#lg-done').innerText()) === '保存');
  ok('改时间面板：标题 + 原时间 + 预告新闹钟', (await page.locator('#lg-title').innerText()).includes('改喂奶时间') && (await page.locator('.sheet').innerText()).includes('原来记的是 今天 22:15'));
  ok('改时间面板只有时间（没有左右/分钟/备注）', await page.locator('.sheet input').count() === 1 && !/左|右|分钟数|备注/.test(await page.locator('.sheet').innerText()));
  await page.click('#lg-ago [data-m="10"]');
  ok('选「10分钟前」→ 预告下次 02:05，按钮变成「保存 · 更新闹钟」', (await page.locator('#lg-alarm').innerText()).includes('02:05') && (await page.locator('#lg-done').innerText()) === '保存 · 更新闹钟');
  if (SHOT) await page.screenshot({ path: SHOTS + '03-log-sheet.png' });
  await page.click('#lg-done');
  text = await payload(page);
  ok('改最近一次的时间 → 按新时间重设（02:05）', times(text)[0] === '2026-09-30 02:05' && text.includes('上次 22:05）'), text);

  // 5) 从历史里改时间（手动选时间）
  await page.goto(BASE + '#/history');
  await page.click('.feed-row >> nth=0');
  await page.waitForSelector('#lg-start');
  await page.fill('#lg-start', '2026-09-29T22:00');
  await page.click('#lg-done');
  text = await payload(page);
  ok('历史里点一条改成 22:00 → 重设 02:00 / 06:00 / 10:00', JSON.stringify(times(text)) === JSON.stringify(['2026-09-30 02:00', '2026-09-30 06:00', '2026-09-30 10:00']), text);

  // 6) 补记更早的一次：先选时间再保存，不影响闹钟
  await clearUrl(page);
  await page.click('#btnBackfill');
  await page.waitForSelector('#lg-start');
  ok('补记：打开面板时还没保存', (await count()) === 2 && (await page.locator('#lg-title').innerText()).includes('补记'));
  await page.fill('#lg-start', '2026-09-30T08:00');
  ok('不能补记未来的时间', (await page.inputValue('#lg-start')) !== '2026-09-30T08:00');
  await page.fill('#lg-start', '2026-09-29T18:00');
  ok('补记更早的：提示闹钟不用变，按钮只写「保存」', (await page.locator('#lg-alarm').innerText()).includes('不用变') && (await page.locator('#lg-done').innerText()) === '保存');
  await page.click('#lg-done');
  await page.waitForTimeout(200);
  ok('补记 18:00 → 保存 3 条、不打开快捷指令', (await count()) === 3 && (await lastUrl(page)) === '');
  ok('历史：今天 3 次（只显示次数和间隔）', (await page.locator('.day-head').first().innerText()).includes('3 次') && !/左|右/.test(await page.locator('#app').innerText()));

  // 7) 删除最近一次 → 回到 20:15 那次重新算
  await page.click('.feed-row >> nth=0');
  await page.waitForSelector('#lg-del');
  await page.click('#lg-del');
  ok('删除要点两次确认', (await page.locator('#lg-del').innerText()).includes('再点一次'));
  await page.click('#lg-del');
  text = await payload(page);
  ok('删除最近一次 → 按上一次（20:15）重设：00:15 / 04:15 / 08:15', JSON.stringify(times(text)) === JSON.stringify(['2026-09-30 00:15', '2026-09-30 04:15', '2026-09-30 08:15']), text);
  await page.click('.feed-row >> nth=0');
  await page.click('#lg-del'); await page.click('#lg-del');
  text = await payload(page);
  ok('再删 20:15 → 按 18:00 算，第1次已过：加一条「已超时」1分钟后响', text.split('\n')[0].includes('🍼 该喂奶了（已超时 · 上次 18:00）'), text);

  // 8) 删除全部 → CLEAR
  await page.click('.feed-row >> nth=0');
  await page.click('#lg-del'); await page.click('#lg-del');
  ok('全部删除 → 只清空（CLEAR）', (await payload(page)) === 'CLEAR');

  // 9) 刚点完发现点错 → 撤销（闹钟也改回去）
  await page.goto(BASE + '#/');
  await page.click('#feedBtn');
  ok('再记一次 → 3 个闹钟', (await payload(page)).split('\n').length === 3);
  await page.click('#btnUndo');
  await page.waitForTimeout(200);
  ok('撤销：记录消失，快捷指令改为清空（CLEAR）', (await count()) === 0 && (await payload(page)) === 'CLEAR');

  // 8) 设置：次数、间隔
  await page.click('#feedBtn');   // 22:15
  await page.goto(BASE + '#/settings');
  await page.click('#cntPlus'); await page.click('#cntPlus'); await page.click('#cntPlus'); await page.click('#cntPlus');
  ok('闹钟次数最多 6', (await page.locator('#cntVal').innerText()) === '6');
  for (let i = 0; i < 8; i++) await page.click('#cntMinus');
  ok('闹钟次数最少 1', (await page.locator('#cntVal').innerText()) === '1');
  await page.click('#cntPlus'); await page.click('#cntPlus');   // 3
  await page.click('#ivChips [data-m="180"]');
  await page.goto(BASE + '#/');
  await page.waitForSelector('#alarmWarn');
  ok('改了间隔 → 首页提示「iPhone 闹钟还没更新」并列出新时间', (await page.locator('#alarmWarn').innerText()).includes('01:15'));
  if (SHOT) await page.screenshot({ path: SHOTS + '09-alarm-warn.png' });
  await page.click('#btnReset');
  text = await payload(page);
  ok('点「更新闹钟」→ 3 小时间隔：01:15 / 04:15 / 07:15', JSON.stringify(times(text)) === JSON.stringify(['2026-09-30 01:15', '2026-09-30 04:15', '2026-09-30 07:15']), text);
  await page.waitForTimeout(200);
  ok('更新后提示消失', await page.locator('#alarmWarn').count() === 0);
  await page.goto(BASE + '#/settings');
  await page.click('#cntPlus');
  await page.click('#btnResetNow');
  ok('次数改成 4 → 传 4 行', (await payload(page)).split('\n').length === 4);
  await page.click('#btnTestAlarm');
  const tp = (await payload(page)).split('\n');
  ok('测试闹钟：测试行（2分钟后）+ 4 个真实闹钟', tp.length === 5 && tp[0].includes('测试喂奶闹钟') && tp[0].startsWith('2026-09-29 22:17'), tp.join(' / '));

  // 9) App 内全屏提醒
  await page.goto(BASE + '#/');
  await page.clock.fastForward('03:00:30');   // 22:15 + 3h = 01:15
  await page.waitForSelector('#alarm:not([hidden])', { timeout: 10000 });
  ok('到点时 App 内弹出全屏「该喂奶了」', (await page.locator('#alarm').innerText()).includes('该喂奶了'));
  ok('全屏提醒说明原因（没有侧别）', /满 3小时.*第1次提醒/s.test(await page.locator('#alarm').innerText()) && !/左边|右边/.test(await page.locator('#alarm').innerText()));
  if (SHOT) await page.screenshot({ path: SHOTS + '06-alarm-fullscreen.png' });
  await page.click('#aFeed');
  await page.waitForTimeout(200);
  text = await payload(page);
  ok('全屏提醒点「现在喂奶」→ 直接记一次并重设（01:15 起每 3 小时，4 个）', (await count()) === 2 && JSON.stringify(times(text)) === JSON.stringify(['2026-09-30 04:15', '2026-09-30 07:15', '2026-09-30 10:15', '2026-09-30 13:15']) && !(await sheetOpen()), text);
  ok('全屏提醒不再重复弹出', await page.locator('#alarm').isHidden());
  const st = await page.locator('#statusCard').innerText();
  ok('状态卡：跨午夜后显示 上次 今天 01:15', st.includes('上次 今天 01:15'), st);

  // 10) 导出 / 导入
  await page.goto(BASE + '#/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnExport')]);
  const file = '/tmp/feed-backup.json';
  await dl.saveAs(file);
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok('导出 JSON（app=feed-record，2 条）', backup.app === 'feed-record' && backup.data.feeds.length === 2, dl.suggestedFilename());
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('feedrecord.v1')); s.feeds = []; localStorage.setItem('feedrecord.v1', JSON.stringify(s)); });
  await page.reload();
  await page.goto(BASE + '#/settings');
  await page.setInputFiles('#fileImport', file);
  await page.click('.sheet [data-a=yes]');
  await page.waitForTimeout(300);
  ok('导入后恢复 2 条', (await count()) === 2);
  // v1.0 的备份（带左右/分钟/备注）也能导入
  const legacy = { app: 'feed-record', exportedAt: '2026-09-29T12:00:00.000Z', data: { version: 1, feeds: [
    { id: 'v1a', start: T('2026-09-29T20:15:00').getTime(), side: 'L', minL: 12, minR: 0, note: '吐奶', createdAt: 1, updatedAt: 2 },
    { id: 'v1b', start: T('2026-09-29T23:40:00').getTime(), side: 'B', minL: 8, minR: 9, note: '', createdAt: 3, updatedAt: 4 }],
    alarm: { sig: 'x|1|L|240|3', sentAt: 0, times: [] }, settings: { intervalMin: 240, alarmCount: 3 } } };
  fs.writeFileSync('/tmp/feed-backup-v1.0.json', JSON.stringify(legacy));
  await page.setInputFiles('#fileImport', '/tmp/feed-backup-v1.0.json');
  await page.click('.sheet [data-a=yes]');
  await page.waitForTimeout(300);
  ok('导入 v1.0 旧备份（带侧别/分钟）：2 条，旧字段保留', (await count()) === 2 && (await page.evaluate(() => JSON.parse(localStorage.getItem('feedrecord.v1')).feeds.find((f) => f.id === 'v1a').minL)) === 12);
  await page.goto(BASE + '#/history'); await page.waitForTimeout(200);
  const ht = await page.locator('#app').innerText();
  ok('旧记录在历史里只显示时间和间隔', ht.includes('23:40') && ht.includes('3小时25分') && !/左|右边|两边|吐奶/.test(ht), ht.slice(0, 300));
  await page.goto(BASE + '#/');
  await page.click('#btnReset');
  ok('旧记录的闹钟文本也没有侧别', (await payload(page)).split('\n')[0].includes('（第1次 · 上次 23:40）'), await payload(page));
  ok('功能测试无 JS 错误', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

// ================= 截图（固定时间 + 一天的示例数据） =================
function seed(now) {
  const H = 3600000, M = 60000;
  const at = (s) => T(s).getTime();
  const f = (id, s, side, minL, minR, note = '') => ({ id, start: at(s), side, minL, minR, note, createdAt: at(s), updatedAt: at(s) });
  const feeds = [
    f('y1', '2026-09-28T18:40:00', 'R', 0, 15), f('y2', '2026-09-28T22:30:00', 'L', 16, 0),
    f('a1', '2026-09-29T01:50:00', 'R', 0, 14), f('a2', '2026-09-29T05:35:00', 'B', 10, 8), f('a3', '2026-09-29T09:10:00', 'L', 18, 0, '吐了一点奶'),
    f('a4', '2026-09-29T12:40:00', 'R', 0, 15), f('a5', '2026-09-29T16:05:00', 'B', 12, 9), f('a6', '2026-09-29T19:55:00', 'L', 15, 0),
  ];
  return { version: 1, feeds, fired: {}, snooze: null,
    alarm: { sig: `a6|${at('2026-09-29T19:55:00')}|L|240|3`, sentAt: at('2026-09-29T19:56:00'), times: [at('2026-09-29T23:55:00'), at('2026-09-30T03:55:00'), at('2026-09-30T07:55:00')] },
    settings: { intervalMin: 240, alarmCount: 3, shortcutName: '喂奶闹钟', autoShortcut: true, sound: true, babyName: '', babyBirthday: '2026-09-17', prefsUpdatedAt: 0 } };
}
if (SHOT) {
  for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await mk(scheme);
    await page.clock.install({ time: T('2026-09-29T21:38:00') });
    await page.addInitScript((s) => { if (!localStorage.getItem('feedrecord.v1')) localStorage.setItem('feedrecord.v1', JSON.stringify(s)); }, seed());
    await page.goto(BASE);
    await page.waitForSelector('#sinceLast');
    await page.waitForTimeout(1200);
    await page.clock.pauseAt(T('2026-09-29T21:39:07'));
    await page.waitForTimeout(300);
    await page.screenshot({ path: SHOTS + (scheme === 'light' ? '01-home-light.png' : '02-home-dark.png') });
    if (scheme === 'light') {
      ok('截图数据：今天 6 次，只显示次数和平均间隔', (await page.locator('#todayCount').innerText()) === '6' && await page.locator('#todayMin').count() === 0 && (await page.locator('#todayGap').innerText()).includes('小时'));
      ok('v1.0 旧数据（5 段闹钟签名、带侧别）升级后不误报「闹钟还没更新」', await page.locator('#alarmWarn').count() === 0 && /23:55/.test(await page.locator('#alarmOk').innerText()));
      ok('首页不显示旧记录的侧别/备注', !/左边|右边|两边|吐了一点奶/.test(await page.locator('#app').innerText()));
      await page.goto(BASE + '#/history'); await page.waitForTimeout(300);
      await page.screenshot({ path: SHOTS + '04-history.png' });
      await page.goto(BASE + '#/help'); await page.waitForTimeout(300);
      await page.evaluate(() => window.scrollTo(0, document.getElementById('h-shortcut').offsetTop - 10));
      await page.waitForTimeout(200);
      await page.screenshot({ path: SHOTS + '05-help-shortcut.png' });
      await page.evaluate(() => window.scrollTo(0, document.querySelector('#h-shortcut ol.steps').offsetTop + 380));
      await page.waitForTimeout(200);
      await page.screenshot({ path: SHOTS + '05b-help-shortcut-steps.png' });
      await page.screenshot({ path: SHOTS + '05c-help-full.png', fullPage: true });
      await page.goto(BASE + '#/settings'); await page.waitForTimeout(300);
      await page.screenshot({ path: SHOTS + '07-settings.png' });
    } else {
      await page.click('.feed-row >> nth=0'); await page.waitForSelector('#lg-done'); await page.waitForTimeout(300);
      await page.screenshot({ path: SHOTS + '08-log-sheet-dark.png' });
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      ok('深色模式跟随系统（背景是深色）', bg === 'rgb(14, 19, 21)', bg);
    }
    ok(`截图（${scheme}）无 JS 错误`, page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  }
}
await browser.close();
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(new URL('./results-e2e.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
