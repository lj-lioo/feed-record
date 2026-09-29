// 线上校验：https://lj-lioo.github.io/feed-record/ 上的每个文件与本地 site/ 逐字节一致；Service Worker 不会删除「宝宝记录」的缓存
// 运行：node test/verify-live.mjs [--sw]   （LIVE=… 可指定地址）
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
const LIVE = (process.env.LIVE || 'https://lj-lioo.github.io/feed-record/').replace(/\/?$/, '/');
const SITE = new URL('../site/', import.meta.url).pathname;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(SITE).map((f) => path.relative(SITE, f)).sort();
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
let bad = 0;
for (const f of files) {
  const local = fs.readFileSync(path.join(SITE, f));
  const res = await fetch(LIVE + f.split(path.sep).map(encodeURIComponent).join('/') + `?v=${Date.now()}`, { cache: 'no-store' });
  const remote = Buffer.from(await res.arrayBuffer());
  const same = res.ok && sha(local) === sha(remote);
  if (!same) bad++;
  console.log(same ? '✅' : '❌', f, res.status, local.length, remote.length);
}
console.log(`\n${files.length - bad}/${files.length} 个文件与线上逐字节一致`);

if (process.argv.includes('--sw')) {
  const { chromium } = await import('playwright');
  const b = await chromium.launch({ executablePath: '/opt/google/chrome/chrome' });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(LIVE);
  await p.evaluate(async () => { const c = await caches.open('baby-record-v9.9.9-test'); await c.put('/baby-record/x', new Response('x')); });
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.waitForTimeout(1500);
  const keys = await p.evaluate(() => caches.keys());
  console.log('caches:', keys.join(', '));
  const okSw = keys.includes('baby-record-v9.9.9-test') && keys.some((k) => k.startsWith('feed-record-'));
  console.log(okSw ? '✅' : '❌', 'SW 安装后：自己的缓存 feed-record-* 存在，宝宝记录的缓存未被删除');
  await p.evaluate(() => caches.delete('baby-record-v9.9.9-test'));
  // 离线打开
  await ctx.setOffline(true);
  await p.reload();
  const offline = await p.locator('#feedBtn').isVisible();
  console.log(offline ? '✅' : '❌', '断网后仍能打开（Service Worker 缓存）');
  console.log(errs.length ? `❌ JS 错误：${errs.join(' | ')}` : '✅ 线上页面无 JS 错误');
  if (!okSw || !offline || errs.length) bad++;
  await b.close();
}
process.exit(bad ? 1 : 0);
