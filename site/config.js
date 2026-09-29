// 部署配置
window.FEED_CONFIG = {
  appVersion: '1.0.0',   // 发布时同时改 sw.js 的 VERSION 和 js/views/settings.js 的 APP_BUILD
  // 云同步服务地址：复用「宝宝记录」的 Cloudflare Worker（按密钥分空间，frs1_ 密钥与宝宝记录的数据完全分开）。
  // 留空 = 不显示「云同步」。
  syncApi: 'https://baby-record-sync.baby-record-e1lwbaby-record-e1lw.workers.dev',
};
