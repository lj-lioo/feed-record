# 喂奶记录 · feed-record

给 iPhone 用的亲喂母乳记录 PWA（纯静态，数据默认只存在手机本地，无登录；可选端到端加密云同步）。「宝宝记录」（baby-record）的姊妹 App。

**在线使用：** https://lj-lioo.github.io/feed-record/ （Safari 打开 → 分享 → 添加到主屏幕）

## 核心：按「最近一次喂奶」自动重设闹钟
- 只记喂奶**时间**（v1.1 起没有左右、分钟、备注）。首页大按钮「🍼 喂奶了」：一点就记下现在的时间，并在**同一次点击里**打开 iOS 快捷指令「喂奶闹钟」（`shortcuts://run-shortcut?name=喂奶闹钟&input=text&text=…`），不弹任何面板。
- 点错了：首页「✅ 刚刚记录了 20:15 · 撤销」；3 分钟内连点两次会先确认。
  快捷指令先删除「提醒事项」→「喂奶」列表里所有未完成的提醒，再新建 N 个 **紧急** 提醒（iOS 26.2+ 像闹钟一样全屏响铃）：上次 + 1×、2×…N× 间隔（默认 4 小时、3 次 → +4h/+8h/+12h）。
- 提前喂奶（例如 2 小时就饿了）：同样点一下，旧闹钟被删、从这次重新算。忘了点：第 2、3 次闹钟还会响。
- 晚记了：大按钮下面「✏️ 改上次时间」，或「历史」里点一条改时间（5/10/15/20/30/45分钟前、1小时前、1.5小时前或任意时间）/删除；忘了记：「🕒 补记一次」。
- 改/删最近一次、修改间隔/次数 → 自动（或首页「⚠️ iPhone 闹钟还没更新」按钮）按重新算出的时间重设；记录全删时只传 `CLEAR` 清空列表。补记或改更早的记录不会打开快捷指令。
- 已经超时（第 1 次时间已过）时，额外加一条 1 分钟后响的「已超时」闹钟。
- App 打开时到点弹出全屏「该喂奶了」页（铃声、现在喂奶（直接记录并重设）、稍后 10 分钟、知道了），作为备用。

## 其他
- 首页：距上次喂奶（实时）、下次喂奶时间、倒计时、进度条、iPhone 闹钟时间列表、今天次数/平均间隔、最近记录（时间 + 距上一次）。
- 历史：近 7 天每天次数 + 按天分组（次数、平均间隔），点一条改时间/删除，「＋ 补记」。
- 旧数据兼容：v1.0 记录里的 side/minL/minR/note 字段原样保留（导入/同步都不丢），只是不再显示；v1.0 的闹钟签名升级时自动转换，不会误报「闹钟还没更新」。
- 设置：间隔（2/2.5/3/3.5/4 小时或自定义 30 分钟～12 小时）、闹钟次数 1～6、快捷指令名称、自动打开快捷指令、测试闹钟（2 分钟后 + 重建真实闹钟）、App 内铃声、宝宝生日（默认 2026-09-17）、云同步、导出/导入 JSON、清空。
- 深色模式跟随系统；大按钮、单手可用。
- 使用帮助：「喂奶闹钟」快捷指令分步搭建（中文）、为什么不用「开始计时器」、限制说明。

## 快捷指令传入格式（与「宝宝闹钟」相同）
每行一个闹钟：`yyyy-MM-dd HH:mm|标题|备注`（设备本地时间），没有记录时为 `CLEAR`；第 1 次已过时首行为 `…|🍼 该喂奶了（已超时 · 上次 HH:mm）|…`（1 分钟后响）：
```
2026-09-30 00:15|🍼 该喂奶了（第1次 · 上次 20:15）|喂奶记录 · 上次 9月29日 20:15 · 间隔4小时 · 第1次提醒（共3次）
2026-09-30 04:15|🍼 该喂奶了（第2次 · 上次 20:15）|喂奶记录 · 上次 9月29日 20:15 · 间隔4小时 · 第2次提醒（共3次）
2026-09-30 08:15|🍼 该喂奶了（第3次 · 上次 20:15）|喂奶记录 · 上次 9月29日 20:15 · 间隔4小时 · 第3次提醒（共3次）
```

## 云同步（可选）与盒子命令行
复用「宝宝记录」的 Cloudflare Worker + D1（未修改、未重新部署）。Worker 按 `sha256(访问令牌)` 分空间；本 App 的密钥是 `frs1_…`，HKDF salt 为 `feed-record-sync/v1`（宝宝记录是 `brs1_` / `baby-record-sync/v1`），所以是完全独立的空间，数据不会混在一起。详见 `sync/README.md`。

盒子命令行：`node sync/feed.js add|last|list|edit|delete|status|init|use-key|pair`。⚠️ 从盒子记的喂奶不会自动重设手机闹钟，手机打开 App 后首页会提示「iPhone 闹钟还没更新」，点一下即可。

## 结构
```
site/                 静态网站（GitHub Pages）
  index.html manifest.json sw.js config.js(syncApi/appVersion) css/app.css icons/src/*.svg(→ workflow 生成 PNG)
  js/feeds.js         纯函数：下次喂奶、闹钟时间、每日次数、时间解析（App 与命令行共用）
  js/shortcuts.js     纯函数：闹钟计划、快捷指令传入文本与 URL
  js/alarmctl.js      当前闹钟状态、打开快捷指令
  js/store.js         localStorage（feedrecord.v1）
  js/sync-core.js sync.js   云同步（frs1_ 密钥，端到端加密）
  js/views/           home / log(记录面板) / history / settings / help / alarm(App 内全屏提醒)
sync/feed.js          盒子命令行
test/                 单元测试（npm test）、Playwright e2e（node test/e2e.mjs）、同步 e2e（node test/sync-e2e.mjs）、线上校验（node test/verify-live.mjs）
screenshots/          手机截图
```

## 测试
```bash
npm test                                   # 单元测试：下次喂奶/提前喂奶重置/编辑删除/跨午夜/时区/快捷指令格式
(cd site && python3 -m http.server 8092 --bind 127.0.0.1) &
node test/e2e.mjs                          # Playwright iPhone 尺寸 e2e + 截图
SYNC_BASE=http://127.0.0.1:8788 node test/sync-e2e.mjs   # 需要本地 wrangler dev 跑宝宝记录的 Worker 代码（见 DEPLOY-NOTES）
node test/verify-live.mjs                  # 线上文件与本地逐字节比对
```

## 部署
推送到 `main`（site/**）后，GitHub Actions 把 `site/` 发布到 `gh-pages`（PNG 图标在 workflow 里由 SVG 生成）。发布时同时改 `config.js` appVersion、`sw.js` VERSION、`js/views/settings.js` APP_BUILD。
