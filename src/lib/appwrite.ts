import { Client, Account, Databases, Storage, Teams, Functions } from "appwrite";

// Appwrite 配置（自托管地址，通过 nginx 同源反代 /v1）。
// 用 window.location.origin 拼接，自动继承当前页面的协议与域名：
//  - 生产环境套 Cloudflare CDN 后是 https://your-domain/v1，Realtime 自动升级为 wss://
//  - 本地开发环境走 vite proxy（见 vite.config.ts 的 /v1 段）
// 不再硬编码 http://IP，避免 HTTPS 页面下的混合内容拦截。
const APPWRITE_ENDPOINT = `${window.location.origin}/v1`;
const APPWRITE_PROJECT_ID = "qingyu";

// 创建 Appwrite 客户端
export const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

// 服务实例
export const account = new Account(client);
export const databases = new Databases(client);
export const storage = new Storage(client);
export const teams = new Teams(client);
export const functions = new Functions(client);

// 数据库 ID（在 Appwrite 控制台创建）
export const DB_ID = "qingyu";

// 集合 ID
export const COLLECTIONS = {
  // 生成记录
  GENERATIONS: "generations",
  // 用户资产
  ASSETS: "assets",
  // 团队设置
  TEAM_SETTINGS: "team_settings",
  // 提示词模板
  PROMPT_TEMPLATES: "prompt_templates",
} as const;

// 存储桶 ID
export const BUCKETS = {
  // 图片存储
  IMAGES: "images",
  // 资产文件
  FILES: "files",
} as const;
