// Service Worker：离线缓存（策略同「宝宝记录」v1.4.1+：安装时 cache:'reload'；页面/JS/CSS/JSON 网络优先 4 秒回退缓存；图标缓存优先）
// 注意：本App和「宝宝记录」同一个网站来源（lj-lioo.github.io），CacheStorage 是共用的：
// - 这里只删除自己的旧缓存（feed-record- 前缀），绝不动宝宝记录的缓存；
// - 宝宝记录的 SW 升级时会删掉“不是它自己的”缓存（包括本App的），所以取不到缓存时会自动从网络重新缓存。
const VERSION = 'v1.1.0';
const PREFIX = 'feed-record-';
const CACHE = `${PREFIX}${VERSION}`;
const ASSETS = [
  './', './index.html', './manifest.json', './config.js', './css/app.css',
  './js/app.js', './js/store.js', './js/feeds.js', './js/shortcuts.js', './js/alarmctl.js', './js/ui.js', './js/sound.js', './js/sync-core.js', './js/sync.js',
  './js/views/home.js', './js/views/log.js', './js/views/history.js', './js/views/alarm.js', './js/views/settings.js', './js/views/help.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];
const NETWORK_TIMEOUT = 4000;

async function fillCache() {
  const fresh = await Promise.all(ASSETS.map(async (u) => {
    const req = new Request(u, { cache: 'reload' });
    const res = await fetch(req);
    if (!res.ok) throw new Error(`${u} → ${res.status}`);
    return [req, res];
  }));
  const c = await caches.open(CACHE);
  await Promise.all(fresh.map(([req, res]) => c.put(req, res)));
}
self.addEventListener('install', (e) => { e.waitUntil(fillCache().then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'version' && e.ports && e.ports[0]) e.ports[0].postMessage({ version: VERSION });
});

async function networkFirst(request, isNav) {
  const url = new URL(request.url);
  const cacheKey = isNav ? new Request(url.origin + url.pathname) : request;
  const net = fetch(isNav ? url.href : request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(async (r) => {
    if (r.ok && r.type === 'basic') { const c = await caches.open(CACHE); await c.put(cacheKey, r.clone()); }
    if (isNav && r.redirected) return new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers });
    return r;
  });
  const fallback = async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(cacheKey, { ignoreSearch: true }) || (isNav ? await c.match('./index.html') || await c.match('./') : null);
    return hit || net;
  };
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback()), NETWORK_TIMEOUT); });
  try {
    return await Promise.race([net.then((r) => { clearTimeout(timer); return r; }), timeout]);
  } catch (err) {
    clearTimeout(timer);
    return fallback();
  }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  if (url.pathname.endsWith('/sw.js')) return;
  const isNav = e.request.mode === 'navigate';
  if (isNav || /\.(?:js|mjs|css|html|json)$/.test(url.pathname) || url.pathname.endsWith('/')) {
    e.respondWith(networkFirst(e.request, isNav));
    // 缓存被别的App的 SW 清掉了：后台补回来
    if (isNav) e.waitUntil(caches.has(CACHE).then((has) => (has ? null : fillCache().catch(() => {}))));
    return;
  }
  e.respondWith(caches.open(CACHE).then((c) => c.match(e.request)).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
    return r;
  })));
});
