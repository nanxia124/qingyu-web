# 自动部署规范

本仓库通过 GitHub Actions 构建前端，并部署到腾讯云轻量服务器。

- SSH 登录账户使用 `ubuntu`，对应公钥位于该账户的 `~/.ssh/authorized_keys`。不能将账户误填为 `root`，否则会出现 `unable to authenticate`。
- 私钥只保存在 GitHub Actions 的 `SSH_PRIVATE_KEY` 加密配置中，不得提交到仓库或写入日志。
- 先上传到 `ubuntu` 可写的 `/home/ubuntu/qingyu-upload`，再通过 `sudo` 复制到 `/var/www/qingyu-web`。
- 上传 `dist/*` 时必须设置 `strip_components: 1`，确保 `index.html` 直接位于上传目录下，避免网站根目录多套一层 `dist` 导致 403。
- 发布前检查上传的 `index.html`；远程脚本遇错即停。发布后检查 Nginx 配置与首页 HTTP 响应，不以文件上传成功作为完整验收。
- 覆盖文件时保留旧的带哈希资源，避免正在打开页面的用户遇到资源丢失；不在发布前清空网站目录。
- 当前工作流只发布前端，API 后台和 Agent 服务需要独立部署。
- 推送前先运行 `npm run build`；页面组件新增登录保护操作时，要在同一组件读取 `useAuthStore` 的 `openAuthModal`，避免生产构建因未定义引用失败。

排查顺序：先定位失败步骤，再查看具体日志。SSH 认证失败时核对登录账户和公钥指纹，并查看服务器的 SSH 日志；上传成功但页面异常时检查网站根目录及 HTTP 状态。

## HTTPS 反代与 Appwrite OAuth

如果域名通过 Cloudflare 等代理访问，源站 Nginx 收到的可能仍是 HTTP。转发到 Appwrite 的 `/v1/` 请求必须把 `X-Forwarded-Proto` 固定传为 `https`，否则 OAuth 地址会不断重定向到自身，浏览器会报 `ERR_TOO_MANY_REDIRECTS`。Appwrite 的 `_APP_DOMAIN`、`_APP_CONSOLE_DOMAIN` 和 Google OAuth 使用的站点域名也必须统一，例如 `litzone.art`，不要继续使用服务器 IP。

如果 Appwrite 自带 Traefik 仍然把转发协议识别为 HTTP，单纯修改 Nginx 请求头不会生效。此时给 `appwrite` 容器增加主机端口（例如 `8081:80`），让 Nginx 直接代理到该端口，并保留 `X-Forwarded-Proto: https`，再检查 OAuth 的 `redirect_uri` 必须以 `https://` 开头。
