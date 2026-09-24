# 网站数据面板（Umami）部署指南

目标：在 `http://你的服务器IP/umami/` 看网站访问、注册、登录、购买转化。

全部用现成开源项目，不写后端代码。**照下面从上到下复制粘贴即可。**

1. **<span style="font-size:18px;color:#fff">这份指南干一件事：给你的网站装一个"访客计数器"。装完后你能看到——今天多少人来过、从微信还是百度来的、多少人注册了、几个人真的掏钱买了会员。全程用现成软件，不用自己写代码，照着从上往下贴命令就行。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">在 http://你的服务器IP/umami/ 部署 Umami，看 PV/UV、来源、注册、登录、购买转化；全部用开源项目，不写后端代码。</span>



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

2. **<span style="font-size:18px;color:#fff">整个数据是怎么流的：每个访客打开你的网页，网页里埋的一小段脚本就自动记一笔"有人来了"，把数据报给你服务器上的 Umami，Umami 再把这些数据存下来。你不用碰访客浏览器里的任何东西，事件（注册、登录、付费）我们代码里早就埋好点了，不用你改。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">架构：浏览器加载 /umami/script.js 自动上报 PV/UV → nginx(80) /umami/ 反代到 Umami 容器 127.0.0.1:3000 → 复用 Appwrite 的 PostgreSQL，新建独立 umami 数据库。业务事件见 src/lib/analytics.ts，无需再改。</span>



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

3. **<span style="font-size:18px;color:#fff">这一步在干嘛：Umami 要把数据存在后台已有的地方，所以得先把账号密码找出来。就是在登录系统的配置文件里翻两行字，抄下来备用。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">步骤1：cd 到 Appwrite 安装目录（/root/appwrite 或 /opt/appwrite 或 ~/appwrite），grep .env 里 _APP_DB_USER、_APP_DB_PASS、_APP_DB_SCHEMA，记下账号密码。</span>

### 步骤 2：在 PostgreSQL 里建一个独立的 umami 数据库

把下面命令里的 `你的APP_DB_USER` 换成上一步看到的 `_APP_DB_USER` 的值，然后执行：



```
docker exec -it appwrite-postgresql \\

&#x20; psql -U 你的APP\_DB\_USER -d appwrite \\

&#x20; -c "CREATE DATABASE umami OWNER 你的APP\_DB\_USER;"
```

如果成功，会输出 `CREATE DATABASE`。如果报 "already exists" 说明之前建过了，忽略即可。

4. **<span style="font-size:18px;color:#fff">这一步在干嘛：在后台已有的数据存储里，单独建一个独立的位置给 Umami 存数据，跟你网站本身的数据分开，互不干扰。把命令里的占位词换成刚才抄的账号密码就行。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">步骤2：docker exec appwrite-postgresql，用 psql -U _APP_DB_USER -d appwrite 执行 CREATE DATABASE umami OWNER 该用户；报 already exists 表示已建过。</span>

### 步骤 3：把项目里的 `docker-compose.umami.yml` 放到服务器上

这个文件在你本地项目根目录 `D:\qingyu-web\docker-compose.umami.yml`。

把它传到服务器（用你平时传代码的方式，比如 scp / 宝塔 / 网页终端的文件上传），

放到和 `appwrite-compose.yml` **同一个目录**下（因为要共用 appwrite docker 网络）。

5. **<span style="font-size:18px;color:#fff">这一步在干嘛：Umami 本身是一个打包好的软件，启动它需要一个配置文件（项目里那个 docker-compose.umami.yml）。你要把这个文件从你电脑传到服务器上，位置和你以前装登录系统用的那个文件放一起，这样它俩才能互相访问。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">步骤3：把本地 D:\qingyu-web\docker-compose.umami.yml 传到服务器，放到与 appwrite-compose.yml 同一目录（共用 appwrite docker 网络）。</span>

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

6. **<span style="font-size:18px;color:#fff">这一步在干嘛：那个配置文件里账号密码的位置现在写的是占位符，要换成你之前抄下来的真账号真密码，Umami 才连得上后台存数据的地方。换完用 grep 检查一眼，确认没有残留的 REPLACE 字样。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">步骤4：sed -i 把 docker-compose.umami.yml 里 REPLACE_DB_USER、REPLACE_DB_PASS 换成真实值，再 grep DATABASE_URL 确认。</span>

### 步骤 5：启动 Umami



```
docker compose -f docker-compose.umami.yml up -d
```

等 20 秒让它初始化数据库表，然后看日志确认启动成功：



```
docker logs umami --tail 30
```

看到 `✓ Compiled` 或 `Listening on http://localhost:3000` 就是好了。

7. **<span style="font-size:18px;color:#fff">这一步在干嘛：按下"开机键"把 Umami 真正跑起来。第一次启动它会自己建好数据表，等约 20 秒，看日志出现"编译完成/正在监听"就说明启动成功了。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">步骤5：docker compose -f docker-compose.umami.yml up -d，等 20 秒初始化表，docker logs umami --tail 30 看到 ✓ Compiled 或 Listening on http://localhost:3000 即成功。</span>

### 步骤 6：更新 nginx 配置并 reload

本地项目里的 `nginx-qingyu-web.conf` 我已经加好了 `/umami/` 反代段。

把这份新配置同步到服务器的 nginx（通常在 `/etc/nginx/sites-available/qingyu-web` 或你之前放的位置），然后：



```
nginx -t && nginx -s reload
```

8. **<span style="font-size:18px;color:#fff">这一步在干嘛：现在 Umami 只在服务器内部跑着，外人还访问不到。需要配置 nginx 把 /umami/ 路径的请求转发到 Umami 服务。改完配置让 nginx 重新加载一下就生效了。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">步骤6：把本地 nginx-qingyu-web.conf 里已加好的 /umami/ 反代段同步到服务器 nginx（/etc/nginx/sites-available/qingyu-web），nginx -t 测试后 nginx -s reload。</span>

### 步骤 7：打开 Umami 后台，注册管理员

浏览器访问：



```
http://你的服务器IP/umami/
```

第一次打开会让你注册管理员账号（邮箱 + 密码），**这是本地账号，跟你网站用户没关系**，自己记好。

9. **<span style="font-size:18px;color:#fff">这一步在干嘛：用浏览器打开 /umami/，第一次进去会让你设一个"看数据后台"的管理员账号。注意：这个账号只用来登录数据面板，跟你网站注册用户完全是两拨人，自己记牢别忘。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">步骤7：浏览器访问 http://你的服务器IP/umami/，首次注册本地管理员账号（邮箱+密码），与网站用户无关。</span>

### 步骤 8：在 Umami 里创建一个 "网站"，拿到 website-id



1. 登录 Umami 后，点右上 **Settings → Websites → Add website**；

2. Name 随便填（比如 "轻域 AI"），Domain 填你网站的域名或 IP（比如 `43.160.249.6`）；

3. 保存后点进这个网站，**Settings → Setup Guide** 里能看到一串 `data-website-id="xxxxxxxx-xxxx-..."`，复制那个 UUID。

10. **<span style="font-size:18px;color:#fff">这一步在干嘛：在 Umami 里"登记"一下你自己的网站，它会发给你一串专属编号（website-id）。有了这串编号，你网页里的上报脚本才知道该把访客数据送到哪里。把这串编号复制下来，下一步要用。</span>**<br>
    <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">步骤8：Umami 后台 Settings → Websites → Add website，Name 填"轻域 AI"，Domain 填域名或 IP（如 43.160.249.6）；保存后 Setup Guide 里复制 data-website-id 的 UUID。</span>



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

11. **<span style="font-size:18px;color:#fff">这一步在干嘛：把刚才那串专属编号，填进你网站首页那一小段脚本里的占位位置。这样访客打开网页时，上报数据才会送到你刚建的 Umami 里，而不是送到别人的。</span>**<br>
    <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">步骤9：打开本地 D:\qingyu-web\index.html，把 data-website-id="REPLACE_WITH_YOUR_WEBSITE_ID" 换成步骤8复制的 UUID。</span>

### 步骤 10：重新 build 并部署前端



```
cd D:\qingyu-web

npm run build
```

把生成的 `dist/` 目录按你平时的方式部署到服务器 `/var/www/qingyu-web/`（跟你以前部署一样）。

12. **<span style="font-size:18px;color:#fff">这一步在干嘛：改完网页得重新"打包"一次，再传到服务器上覆盖旧网页，访客浏览器里才会带上新的上报脚本。跟你平时发版的动作一模一样。</span>**<br>
    <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">步骤10：cd D:\qingyu-web，npm run build，把 dist/ 目录部署到服务器 /var/www/qingyu-web/（与以往相同方式）。</span>

### 步骤 11：验证

打开你的网站首页，用**无痕窗口**访问一下，再回到 Umami 后台刷新 —— 应该能立刻看到一条实时访问记录。

13. **<span style="font-size:18px;color:#fff">这一步在干嘛：最后验收。开一个无痕窗口自己访问一下网站，再回 Umami 后台刷新——如果马上蹦出一条实时访客记录，说明整条"访客→上报→记录→你能看"的路全通了。没蹦出来就回头查编号填对没、nginx 配好没。</span>**<br>
    <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">步骤11：无痕窗口访问网站首页，回 Umami 后台刷新，应立刻看到一条实时访问记录。</span>



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

14. **<span style="font-size:18px;color:#fff">装好以后，这个后台能帮你看这些事：今天来了多少人、多少人在线、他们从哪来、用什么设备、哪个页面看的人多。更关键的是四条"业务事件"——谁注册了、谁登录了、谁点了升级会员、谁真付了钱。把这四个按顺序排成一条"漏斗"，就能一眼看出：100 个人进来，最后几个人掏钱了，中间哪一步掉的人最多。</span>**<br>
    <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">Umami 后台：PV/UV/在线人数看首页仪表盘；来源/国家/设备/浏览器看首页下方；每页浏览量看 Pages 标签；注册/登录/点升级/支付成功看 Events 标签；访问→注册→登录→付费漏斗看 Funnels 标签。事件名固定：register_success、login_success、click_upgrade_plan、payment_success。</span>



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

15. **<span style="font-size:18px;color:#fff">至于"这个月一共多少人、收了多少钱"这种月度报表：现在人少，直接在 Umami 的 Events 里数就行，别折腾。等你真有了稳定用户、想做正经月报了，再装一个专门画报表的软件（Metabase）去连后台存数据的地方，那是以后的事，现在不用动。</span>**<br>
    <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">当前阶段先用 Umami Events 看；以后做月度收入报表时再装 Metabase 直连 PostgreSQL（复用 umami 库 + Appwrite 业务库），暂不安装。</span>



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

16. **<span style="font-size:18px;color:#fff">最后三个常见毛病，心里有数就行：打不开多半是后台存数据的账号密码没填对、或者 Umami 的独立位置没建；能打开后台但网页没数，多半是网站首页里那串编号填错了；至于安全——数据后台只对你自己这台服务器的内部开放，外人摸不到，只能通过你网站的正常入口进，不用担心。</span>**<br>
    <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">FAQ：/umami/ 404 或 502 看 docker logs umami，多为 DATABASE_URL 未替换或未建 umami 库；后台能开但网页无数，检查 index.html 的 website-id 和 F12→Network 是否向 /umami/api/send 发请求；安全上 compose 绑定 127.0.0.1:3000:3000 只监听本机，公网只能经 nginx 80 进入。</span>