# 喂奶记录 · 云同步（可选）

- **服务端**：直接复用「宝宝记录」已部署的 Worker（`https://baby-record-sync.baby-record-e1lwbaby-record-e1lw.workers.dev`，代码在 baby-record 仓库 `sync/worker`）。**没有修改、没有重新部署**。
  - Worker 的 CORS 白名单已包含 `https://lj-lioo.github.io`（本 App 同源），`SPACE_ALLOWLIST` 为空，所以新空间可直接使用。
  - 服务端只看到：空间 id（`sha256(令牌)`）、记录 id（`feed:<id>` / `prefs`）、修改时间、删除标记、密文。
- **隔离**：本 App 的同步密钥是 `frs1_` + 32 字节随机数；HKDF salt `feed-record-sync/v1`。宝宝记录是 `brs1_` + salt `baby-record-sync/v1`。
  两个 App 的密钥格式互不接受，同样的随机字节也会派生出不同的令牌 → 不同的空间（`test/sync-e2e.mjs` 验证）。宝宝记录的数据集和 `~/.config/baby-record/sync.env` 完全不碰。
- **同步内容**：每条喂奶记录（最后写入者胜，删除 = tombstone）+ `prefs`（间隔、闹钟次数、宝宝生日/小名）。本机的「已交给快捷指令的闹钟」状态不同步（每台 iPhone 自己的提醒事项）。
- **App**：设置 → ☁️ 云同步：粘贴密钥 / 生成新密钥；打开时、修改后 1.5 秒、切回前台、恢复联网、前台每分钟同步。
- ⚠️ `*.workers.dev` 在中国大陆被屏蔽：不开 VPN 时同步会失败（本机记录照常可用）。

## 盒子命令行 `feed.js`
配置在 `~/.config/feed-record/sync.env`（600 权限；与宝宝记录分开）。时间按 Asia/Shanghai。
```bash
node sync/feed.js init                        # 生成 frs1_ 密钥（只显示指纹），Worker 地址取 site/config.js
node sync/feed.js pair --qr ~/.config/feed-record/pair.png   # 给手机扫码配对（内容 https://lj-lioo.github.io/feed-record/#pair=<密钥>），扫完删除
FEED_SYNC_KEY=… node sync/feed.js use-key     # 或者采用手机上生成的密钥
node sync/feed.js add --at -20m --side 左 --left 15 --right 10 --note 吐奶
node sync/feed.js last                        # 最近一次、下次喂奶、手机上应响的闹钟
node sync/feed.js list --days 3
node sync/feed.js edit <id> --at 20:15 --side 右   |   node sync/feed.js delete <id>
```
**限制**：盒子上记录/修改/删除「最近一次」后，手机上的「喂奶闹钟」不会自动变 —— 网页 App 只能在用户点击时打开快捷指令。手机打开 App 同步后首页会显示「⚠️ iPhone 闹钟还没更新」，点「更新闹钟」即可。在那之前，手机上按旧的最近一次响铃。
