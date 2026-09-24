# 网站数据面板（Umami）部署指南

目标：在 `http://你的服务器IP/umami/` 看网站访问、注册、登录、购买转化。

全部用现成开源项目，不写后端代码。**照下面从上到下复制粘贴即可。**



***

## 这是什么

一个看网站数据的面板（Umami）。能看到今天多少人访问了、从哪来的、多少人注册了、多少人付费了。

## 怎么用

部署好后，访问 `http://你的服务器IP/umami/`，登录管理员账号就能看数据。

## 现在长什么样

- ✅ 部署步骤写好了，照抄就行
- ✅ 注册/登录/付费这些关键事件已经埋好点
- ❓ 还没实际部署到服务器

## 详细部署步骤

## 架构一句话



```
浏览器

&#x20; └─ 加载 /umami/script.js（埋点脚本，自动上报 PV/UV）

&#x20;       │

&#x20;       ▼

&#x20; nginx（80）── /umami/ ──► Umami 容器（127.0.0.1:3000）

&#x20;                                   │

&#x20;                                   ▼

&#x20;                         复用 Appwrite 的 PostgreSQL

&#x20;                         （新建一个独立的 umami 数据库）
```

前端业务事件（登录成功 / 注册成功 / 点升级 / 支付成功）已经在代码里埋好了，

见 `src/lib/analytics.ts`，不用再改。



***

## 这是什么

一个看网站数据的面板（Umami）。能看到今天多少人访问了、从哪来的、多少人注册了、多少人付费了。

## 怎么用

部署好后，访问 `http://你的服务器IP/umami/`，登录管理员账号就能看数据。

## 现在长什么样

- ✅ 部署步骤写好了，照抄就行
- ✅ 注册/登录/付费这些关键事件已经埋好点
- ❓ 还没实际部署到服务器

## 详细部署步骤

## 第一部分：在服务器上操作（在你现在打开的腾讯云终端里执行）

### 步骤 1：找到 Appwrite 的安装目录和数据库账号密码



```
\# 进入你当初装 Appwrite 的目录（一般是 /root/appwrite 或 /opt/appwrite）

cd /root/appwrite 2>/dev/null || cd /opt/appwrite 2>/dev/null || cd \~/appwrite

\# 从 .env 里读出数据库账号密码（记下来，下一步要用）

grep -E "^\_APP\_DB\_USER=|^\_APP\_DB\_PASS=|^\_APP\_DB\_SCHEMA=" .env
```

执行完会输出三行，类似：



```
\_APP\_DB\_USER=user\_xxx

\_APP\_DB\_PASS=xxxxxxx

\_APP\_DB\_SCHEMA=appwrite
```

把 `_APP_DB_USER` 和 `_APP_DB_PASS` 的值记在记事本里。

### 步骤 2：在 PostgreSQL 里建一个独立的 umami 数据库

把下面命令里的 `你的APP_DB_USER` 换成上一步看到的 `_APP_DB_USER` 的值，然后执行：



```
docker exec -it appwrite-postgresql \\

&#x20; psql -U 你的APP\_DB\_USER -d appwrite \\

&#x20; -c "CREATE DATABASE umami OWNER 你的APP\_DB\_USER;"
```

如果成功，会输出 `CREATE DATABASE`。如果报 "already exists" 说明之前建过了，忽略即可。

### 步骤 3：把项目里的 `docker-compose.umami.yml` 放到服务器上

这个文件在你本地项目根目录 `D:\qingyu-web\docker-compose.umami.yml`。

把它传到服务器（用你平时传代码的方式，比如 scp / 宝塔 / 网页终端的文件上传），

放到和 `appwrite-compose.yml` **同一个目录**下（因为要共用 appwrite docker 网络）。

### 步骤 4：把 compose 里的数据库账号密码占位符替换成真实值

在服务器上，进入放了 `docker-compose.umami.yml` 的目录，执行（把两个占位符换成真实值）：



```
sed -i "s/REPLACE\_DB\_USER/你的APP\_DB\_USER/g; s/REPLACE\_DB\_PASS/你的APP\_DB\_PASS/g" \\

&#x20; docker-compose.umami.yml
```

检查一下替换对不对：



```
grep DATABASE\_URL docker-compose.umami.yml
```

应该能看到真实账号密码，不再有 `REPLACE_`。

### 步骤 5：启动 Umami



```
docker compose -f docker-compose.umami.yml up -d
```

等 20 秒让它初始化数据库表，然后看日志确认启动成功：



```
docker logs umami --tail 30
```

看到 `✓ Compiled` 或 `Listening on http://localhost:3000` 就是好了。

### 步骤 6：更新 nginx 配置并 reload

本地项目里的 `nginx-qingyu-web.conf` 我已经加好了 `/umami/` 反代段。

把这份新配置同步到服务器的 nginx（通常在 `/etc/nginx/sites-available/qingyu-web` 或你之前放的位置），然后：



```
nginx -t && nginx -s reload
```

### 步骤 7：打开 Umami 后台，注册管理员

浏览器访问：



```
http://你的服务器IP/umami/
```

第一次打开会让你注册管理员账号（邮箱 + 密码），**这是本地账号，跟你网站用户没关系**，自己记好。

### 步骤 8：在 Umami 里创建一个 "网站"，拿到 website-id



1. 登录 Umami 后，点右上 **Settings → Websites → Add website**；

2. Name 随便填（比如 "轻域 AI"），Domain 填你网站的域名或 IP（比如 `43.160.249.6`）；

3. 保存后点进这个网站，**Settings → Setup Guide** 里能看到一串 `data-website-id="xxxxxxxx-xxxx-..."`，复制那个 UUID。



***

## 这是什么

一个看网站数据的面板（Umami）。能看到今天多少人访问了、从哪来的、多少人注册了、多少人付费了。

## 怎么用

部署好后，访问 `http://你的服务器IP/umami/`，登录管理员账号就能看数据。

## 现在长什么样

- ✅ 部署步骤写好了，照抄就行
- ✅ 注册/登录/付费这些关键事件已经埋好点
- ❓ 还没实际部署到服务器

## 详细部署步骤

## 第二部分：本地改一行，重新部署前端

### 步骤 9：把 website-id 填进 index.html

打开本地 `D:\qingyu-web\index.html`，找到这一行：



```
data-website-id="REPLACE\_WITH\_YOUR\_WEBSITE\_ID"
```

把 `REPLACE_WITH_YOUR_WEBSITE_ID` 换成步骤 8 复制的 UUID。

### 步骤 10：重新 build 并部署前端



```
cd D:\qingyu-web

npm run build
```

把生成的 `dist/` 目录按你平时的方式部署到服务器 `/var/www/qingyu-web/`（跟你以前部署一样）。

### 步骤 11：验证

打开你的网站首页，用**无痕窗口**访问一下，再回到 Umami 后台刷新 —— 应该能立刻看到一条实时访问记录。



***

## 这是什么

一个看网站数据的面板（Umami）。能看到今天多少人访问了、从哪来的、多少人注册了、多少人付费了。

## 怎么用

部署好后，访问 `http://你的服务器IP/umami/`，登录管理员账号就能看数据。

## 现在长什么样

- ✅ 部署步骤写好了，照抄就行
- ✅ 注册/登录/付费这些关键事件已经埋好点
- ❓ 还没实际部署到服务器

## 详细部署步骤

## 在 Umami 后台能看到什么



| 指标                                | 在哪看                                        |
| --------------------------------- | ------------------------------------------ |
| PV / UV / 在线人数                    | 首页仪表盘                                      |
| 访问来源（直接 / Google / 微信等）、国家、设备、浏览器 | 首页下方                                       |
| 每个页面的浏览量（路由）                      | **Pages** 标签                               |
| 注册成功 / 登录成功 / 点升级 / 支付成功          | **Events** 标签（按事件名筛选）                      |
| 访问 → 注册 → 登录 → 付费 转化漏斗            | **Funnels** 标签，点 Create funnel，按顺序选这 4 个事件 |

事件名固定为：



* `register_success`

* `login_success`

* `click_upgrade_plan`

* `payment_success`



***

## 这是什么

一个看网站数据的面板（Umami）。能看到今天多少人访问了、从哪来的、多少人注册了、多少人付费了。

## 怎么用

部署好后，访问 `http://你的服务器IP/umami/`，登录管理员账号就能看数据。

## 现在长什么样

- ✅ 部署步骤写好了，照抄就行
- ✅ 注册/登录/付费这些关键事件已经埋好点
- ❓ 还没实际部署到服务器

## 详细部署步骤

## 以后想看 "业务报表"（注册总数、付费用户数、收入）

当前阶段先靠 Umami 的 Events 标签看。等你每天有真实用户、想做月度收入报表时，

再装 Metabase 直连这个 PostgreSQL（同样复用 `umami` 数据库 + Appwrite 自己的业务库），

到时再说，不用现在装。



***

## 这是什么

一个看网站数据的面板（Umami）。能看到今天多少人访问了、从哪来的、多少人注册了、多少人付费了。

## 怎么用

部署好后，访问 `http://你的服务器IP/umami/`，登录管理员账号就能看数据。

## 现在长什么样

- ✅ 部署步骤写好了，照抄就行
- ✅ 注册/登录/付费这些关键事件已经埋好点
- ❓ 还没实际部署到服务器

## 详细部署步骤

## 常见问题

**Q: 访问 /umami/ 打开是 404 或 502？**

看 `docker logs umami`，多半是步骤 4 的 DATABASE\_URL 没替换对，或者 PG 里没建 umami 数据库。

**Q: Umami 后台能打开，但网站访问没有数据？**

检查 index.html 里的 website-id 是不是填对了；浏览器 F12 → Network 里看有没有向 `/umami/api/send` 发请求。

**Q: 安全吗？3000 端口要不要关？**

compose 里写的是 `127.0.0.1:3000:3000`，只监听本机，公网访问不到，只能通过 nginx 的 80 端口进，没问题。