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
