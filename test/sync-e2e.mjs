// 云同步端到端测试（本地 Worker：宝宝记录的同一份 Worker 代码，wrangler dev --local；不碰生产 D1）
// ① 盒子命令行 feed.js：init / add / last / list / edit / delete；② 手机 App 用同一密钥连接 → 收到盒子记的喂奶，首页提示「iPhone 闹钟还没更新」；
// ③ App 记的喂奶 → 命令行能看到；④ 与宝宝记录的数据隔离（brs1_ 密钥被拒；同样的随机字节派生出不同的空间）。
// 运行：SYNC_BASE=http://127.0.0.1:8788 BASE=http://127.0.0.1:8092/ node test/sync-e2e.mjs
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
const SYNC = process.env.SYNC_BASE || 'http://127.0.0.1:8788';
const BASE = process.env.BASE || 'http://127.0.0.1:8092/';
const results = [];
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(cond ? '✅' : '❌', name, cond ? '' : extra); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedcli-'));
const ENV = path.join(dir, 'sync.env');
const cli = (...args) => { try { return execFileSync(process.execPath, [new URL('../sync/feed.js', import.meta.url).pathname, ...args], { env: { ...process.env, FEED_SYNC_ENV: ENV, FEED_SYNC_KEY: '', FEED_SYNC_URL: '' }, encoding: 'utf8', stdio: 'pipe' }); } catch (e) { return 'ERR ' + e.stderr + e.stdout; } };

// ① 命令行
let out = cli('init', '--url', SYNC);
ok('init 生成 frs1_ 密钥（只显示指纹），文件权限 600', /已生成新的同步密钥（frs1_.{2}…/.test(out) && (fs.statSync(ENV).mode & 0o777) === 0o600, out);
ok('init 输出里没有完整密钥', !/frs1_[A-Za-z0-9_-]{43}/.test(out));
const key = /FEED_SYNC_KEY=(\S+)/.exec(fs.readFileSync(ENV, 'utf8'))[1];
out = cli('add', '--at', '-20m', '--side', '左', '--left', '12');
ok('add --at -20m --side 左 --left 12', out.includes('已记录') && out.includes('左边  左12') && out.includes('还没重设'), out);
out = cli('last');
ok('last：距上次 20分钟，列出应响的 3 个闹钟', /距上次喂奶 (19|20)分钟/.test(out) && (out.match(/、/g) || []).length === 2, out);
const id = /\[([a-z0-9]+)\]/.exec(out)[1];
out = cli('edit', id, '--left', '15');
ok('edit 只改分钟数 → 不提示重设闹钟', out.includes('左15') && !out.includes('闹钟时间变了'), out);
out = cli('edit', id, '--right', '5');
ok('edit 左边的记录又加右边分钟 → 变成两边，并提示重设闹钟（标题里的侧别变了）', out.includes('两边  左15  右5') && out.includes('闹钟时间变了'), out);
out = cli('add', '--at', 'x');
ok('错误的时间会报错', out.startsWith('ERR') && out.includes('看不懂的时间'), out);

// ④ 隔离：宝宝记录的 brs1_ 密钥不能用；同样 32 字节在两个 App 下派生出不同的令牌（= 不同的服务器空间）
const bad = (() => { try { execFileSync(process.execPath, [new URL('../sync/feed.js', import.meta.url).pathname, 'use-key'], { env: { ...process.env, FEED_SYNC_ENV: path.join(dir, 'x.env'), FEED_SYNC_KEY: 'brs1_' + 'A'.repeat(43) }, encoding: 'utf8', stdio: 'pipe' }); return ''; } catch (e) { return e.stderr; } })();
ok('use-key 拒绝宝宝记录的 brs1_ 密钥', bad.includes('宝宝记录'), bad);
const fcore = await import('../site/js/sync-core.js');
const bsrc = fs.readFileSync('/workspace/baby-app/site/js/sync-core.js', 'utf8');
const bcore = await import('data:text/javascript;base64,' + Buffer.from(bsrc).toString('base64'));
const body = key.slice(5);
const tf = (await fcore.deriveKeys('frs1_' + body)).token, tb = (await bcore.deriveKeys('brs1_' + body)).token;
ok('同样的随机字节：喂奶记录与宝宝记录派生出不同的访问令牌（服务器空间不同）', tf !== tb && tf.length === 43 && tb.length === 43);
ok('宝宝记录的 sync-core 不认 frs1_ 密钥（反过来也不会混用）', bcore.extractSyncKey(key) === '' && fcore.extractSyncKey('brs1_' + body) === '');
// 用宝宝记录的派生方式访问这个空间 → 看不到喂奶记录
const other = await bcore.syncRequest(SYNC, tb, { since: 0, changes: [] });
ok('宝宝记录一侧的空间里没有喂奶数据', other.changes.length === 0);

// ② 手机 App 连接同一密钥
const browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
await ctx.addInitScript((u) => { window.__FEED_TEST__ = true; if (!localStorage.getItem('feedrecord.sync')) localStorage.setItem('feedrecord.sync', JSON.stringify({ url: u })); }, SYNC);
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(BASE + '#/settings');
await page.waitForSelector('#syncPaste');
await page.fill('#syncPaste', key);
await page.click('#btnSyncJoin');
await page.waitForSelector('#btnSyncNow', { timeout: 10000 });
ok('App 粘贴密钥 → 连接成功', (await page.locator('#syncState').innerText()).includes('已开启'), await page.locator('#syncState').innerText());
await page.goto(BASE + '#/');
await page.waitForSelector('#alarmWarn');
ok('收到盒子记的喂奶，首页提示「iPhone 闹钟还没更新」', (await page.locator('.feed-row').count()) === 1 && (await page.locator('#alarmWarn').innerText()).includes('还没更新'));
ok('记录标注「来自助手」', (await page.locator('.feed-row').innerText()).includes('来自助手'));
await page.click('#btnReset');
ok('点「更新闹钟」→ 生成 3 行传入文本', (await page.evaluate(() => decodeURIComponent(window.__lastShortcutUrl))).split('\n').length === 3);

// ③ App 记一次 → 命令行可见；App 改间隔 → 命令行按新间隔算
await page.click('#feedBtn'); await page.click('#lg-side [data-s=R]'); await page.click('#lg-done');
await page.goto(BASE + '#/settings'); await page.click('#ivChips [data-m="180"]');
await page.waitForTimeout(2500);
out = cli('list');
ok('命令行 list 能看到 App 记的（右边）和自己记的（两边，[助手]）', out.includes('右边  [') && out.includes('两边  左15  右5  [助手]') && out.includes('2 次'), out);
out = cli('last');
ok('命令行 last 按 App 设置的 3 小时间隔计算', out.includes('间隔 3小时'), out);
const appId = /最近一次：.*\[([a-z0-9]+)\]/.exec(out)[1];
out = cli('delete', appId);
ok('命令行删除最近一次 → 提示手机上重设闹钟', out.includes('已删除') && out.includes('更新闹钟'), out);
await page.goto(BASE + '#/');
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForTimeout(2500);
ok('App 同步到删除（剩 1 条），并提示闹钟需要更新', (await page.locator('.feed-row').count()) === 1 && (await page.locator('#alarmWarn').count()) === 1);
ok('同步测试无 JS 错误', errs.length === 0, errs.join(' | '));
await browser.close();
fs.rmSync(dir, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(new URL('./results-sync.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
