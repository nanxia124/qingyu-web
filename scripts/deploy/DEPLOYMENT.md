# Qingyu Web 部署说明

## 构建

在项目根目录执行：

```bash
npm run build
```

构建产物位于 `dist/`。本次部署前修复了 3 个 TypeScript 未使用变量错误，否则生产构建会失败。

## 腾讯云轻量服务器

服务器使用 Ubuntu + Nginx，站点目录为 `/var/www/qingyu-web`。

发布静态文件：

```bash
sudo unzip -o qingyu-web-dist.zip -d /var/www/qingyu-web
sudo chown -R www-data:www-data /var/www/qingyu-web
sudo nginx -t
sudo systemctl reload nginx
```

Nginx 使用 `try_files $uri $uri/ /index.html`，因此 React Router 的前端路由可以直接刷新访问。

## 当前限制

`src/lib/appwrite.ts` 仍使用 `http://localhost/v1` 作为 Appwrite 地址。部署到公网后，登录、用户和团队功能需要将它改为实际的 Appwrite 服务地址；管理员页面的 API 地址通过 `VITE_API_URL` 配置。

## 计费数据库

当前服务器使用 PostgreSQL 保存用户映射、个人工作空间、套餐、订单、支付、订阅和额度流水。API 服务通过 `/etc/qingyu-api.env` 读取 `BILLING_STORE=postgres`、`PGHOST`、`PGDATABASE`、`PGUSER` 和 `PGPASSWORD`；密码文件权限必须是 `600`，不能提交到仓库。Appwrite 仍只负责登录身份，`app.user_accounts.appwrite_user_id` 负责把登录身份和业务数据连接起来。

服务器首次部署 API 运行时依赖时，在 `/home/ubuntu/qingyu-api` 执行 `npm install --omit=dev`，会按 `scripts/deploy/package.json` 安装 `pg`。切换前应在隔离测试用户上验证注册、套餐、订单幂等、付款幂等和权益发放，确认后再重启 `qingyu-api`。

