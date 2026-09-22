import { Client, Account, Databases, Storage, Teams, Functions } from "appwrite";

// Appwrite 配置（自托管地址，通过 nginx 同源反代 /v1）
const APPWRITE_ENDPOINT = "http://43.160.249.6/v1";
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
