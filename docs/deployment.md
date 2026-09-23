# 自动部署规范

本仓库通过 GitHub Actions 构建前端，并部署到腾讯云轻量服务器。

- SSH 登录账户使用 `ubuntu`，对应公钥位于该账户的 `~/.ssh/authorized_keys`。不能将账户误填为 `root`，否则会出现 `unable to authenticate`。
- 私钥只保存在 GitHub Actions 的 `SSH_PRIVATE_KEY` 加密配置中，不得提交到仓库或写入日志。
- 先上传到 `ubuntu` 可写的 `/home/ubuntu/qingyu-upload`，再通过 `sudo` 复制到 `/var/www/qingyu-web`。
- 上传 `dist/*` 时必须设置 `strip_components: 1`，确保 `index.html` 直接位于上传目录下，避免网站根目录多套一层 `dist` 导致 403。
- 发布前检查上传的 `index.html`；远程脚本遇错即停。发布后检查 Nginx 配置与首页 HTTP 响应，不以文件上传成功作为完整验收。
- 覆盖文件时保留旧的带哈希资源，避免正在打开页面的用户遇到资源丢失；不在发布前清空网站目录。
- 当前工作流只发布前端，API 后台和 Agent 服务需要独立部署。

排查顺序：先定位失败步骤，再查看具体日志。SSH 认证失败时核对登录账户和公钥指纹，并查看服务器的 SSH 日志；上传成功但页面异常时检查网站根目录及 HTTP 状态。
