# 部署备忘（给后续维护）
- 前端：GitHub Pages https://lj-lioo.github.io/feed-record/ （repo lj-lioo/feed-record，main 分支 site/ → Actions `deploy.yml` → gh-pages）
  - 与「宝宝记录」同一套：推送 site/** 到 main 触发部署；也可 workflow_dispatch 传 src_url + src_sha256 导入整个源码 tar.gz（首次部署就是这样导入的，PNG 图标随包导入，保证逐字节一致）。
  - 连接器 user-Github 没有 workflow 权限；user-GitHub-xai 可以推 .github/workflows 并触发 workflow_dispatch。
  - 发布新版本时同时改：site/config.js appVersion、site/sw.js VERSION、site/js/views/settings.js APP_BUILD。
  - 推送后运行 `node test/verify-live.mjs --sw` 逐字节比对线上文件，并检查 SW 缓存不影响宝宝记录。
- 同源注意：本 App 与宝宝记录都在 lj-lioo.github.io 下 → localStorage 和 CacheStorage 同源共用。
  - localStorage 键名全部 `feedrecord.*`（宝宝记录是 `babyrecord.*`）。
  - 本 App 的 SW 只删 `feed-record-*` 旧缓存；宝宝记录的 SW 升级时会删掉所有非它自己的缓存（包括 feed-record-*，这是宝宝记录的现有行为，未修改它），本 App 的 SW 发现缓存没了会在下次打开时自动重新缓存。
- 云同步：复用宝宝记录的 Worker（config.js syncApi），未改动 Worker，也未碰宝宝记录的数据集或 ~/.config/baby-record/sync.env。说明见 sync/README.md。
  - 本地测试：把 baby-record 的 sync/worker 代码拷到 /tmp/feed-worker（database_id 随便填、ALLOWED_ORIGINS 加 http://127.0.0.1:8092），
    `PATH=~/.local/node22/bin:$PATH npx wrangler d1 migrations apply baby-record-sync --local && npx wrangler dev --port 8788 --ip 127.0.0.1`，
    然后 `SYNC_BASE=http://127.0.0.1:8788 node test/sync-e2e.mjs`（不会写生产 D1）。
- 测试：`npm test`（单元）、`node test/e2e.mjs`（需 `cd site && python3 -m http.server 8092 --bind 127.0.0.1`；生成 screenshots/）、`node test/sync-e2e.mjs`、`node test/verify-live.mjs --sw`。
