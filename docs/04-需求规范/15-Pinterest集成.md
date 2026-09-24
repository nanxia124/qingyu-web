# Pinterest 集成需求规范

> 版本：v1.0
> 日期：2026-09-24
> 状态：待开发



***

### 这是什么
让用户在网站里直接搜 Pinterest 灵感图，不用跳来跳去。

1. **<span style="font-size:18px;color:#fff">你在网站里就能直接搜Pinterest上的灵感图，不用来回切网站复制粘贴。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">让用户在网站里直接搜 Pinterest 灵感图，不用跳来跳去。</span>


### 用户怎么用
- 画布里打开"灵感"面板，输关键词搜 Pinterest
- 缩略图墙展示，点一下拖进画布
- 自动处理版权和来源，不用离开网站

2. **<span style="font-size:18px;color:#fff">画布里开个"灵感"面板，输入关键词就能搜；看中的图点一下拖进画布就行，版权来源系统自动处理，不用你离开网站。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">画布里打开"灵感"面板，输关键词搜 Pinterest；缩略图墙展示，点一下拖进画布；自动处理版权和来源，不用离开网站。</span>


### 现在长什么样
还没开始做，需求已想清楚。

3. **<span style="font-size:18px;color:#fff">还没开始写代码，但要做什么已经想清楚了。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">还没开始做，需求已想清楚。</span>


## 1. 背景与目标

### 1.1 背景

Litzone（qingyu-web）是一个 AI 设计画布工具，设计师在创作过程中需要大量灵感参考图。当前用户需要在 Pinterest / 本地文件夹 / 项目之间反复跳转，效率低。

4. **<span style="font-size:18px;color:#fff">设计师找灵感时，要在Pinterest、自己电脑文件夹、我们的画布之间来回切，复制粘贴很麻烦，效率低。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">Litzone（qingyu-web）是一个 AI 设计画布工具，设计师在创作过程中需要大量灵感参考图。当前用户需要在 Pinterest / 本地文件夹 / 项目之间反复跳转，效率低。</span>


### 1.2 目标

通过 Pinterest 官方 API，让用户一键授权登录，并自动同步其 Pinterest 账号下的画板（Board）和图片（Pin）到 Litzone 素材库，在画布中直接调用参考图。

5. **<span style="font-size:18px;color:#fff">你点一下"授权登录"，Pinterest账号里的画板和图片就自动同步到我们的素材库，在画布里直接调用。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">通过 Pinterest 官方 API，让用户一键授权登录，并自动同步其 Pinterest 账号下的画板（Board）和图片（Pin）到 Litzone 素材库，在画布中直接调用参考图。</span>


### 1.3 非目标（本期不做）




* ❌ 浏览器扩展插件（灵感采集 Clipper）—— 后期单独做

* ❌ 花瓣网、站酷等无 API 平台的接入

* ❌ 向 Pinterest 发布 Pin（写操作）—— 本期只读

* ❌ Pinterest 广告、电商目录等能力




***

## 2. Pinterest Developer 申请准备

### 2.1 前置账号




* Pinterest Business Account（免费注册，个人号可转企业号）

* 注册地址：[https://developers.pinterest.com](https://developers.pinterest.com)

6. **<span style="font-size:18px;color:#fff">要先用一个Pinterest企业号（免费注册，个人号可以转成企业号）才能申请访问权限。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">Pinterest Business Account（免费注册，个人号可转企业号）；注册地址：https://developers.pinterest.com</span>


### 2.2 创建 App 时填写的信息




| 字段                 | 值                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------- |
| App Name           | Litzone                                                                                 |
| Description        | AI design canvas tool that lets users sync their Pinterest inspiration boards and pins. |
| Redirect URI（生产）   | `https://litzone.art/auth/pinterest/callback`                                           |
| Redirect URI（本地）   | `http://localhost:5173/auth/pinterest/callback`                                         |
| Privacy Policy URL | 复用现有隐私政策页面（如暂无则用占位）                                                                     |

### 2.3 申请的权限 Scope




| Scope                | 用途                    | 是否必须  |
| -------------------- | --------------------- | ----- |
| `user_accounts:read` | 获取用户 Pinterest 用户名、头像 | ✅ 登录用 |
| `boards:read`        | 读取用户画板列表              | ✅ 同步用 |
| `pins:read`          | 读取画板下的 Pin 图片         | ✅ 同步用 |

**Trial Access**：提交后 1\~2 个工作日审核通过，额度 1000 请求 / 天，创建的测试 Pin 不可见（本期只读无影响）。

**Standard Access**：正式上线前需录 demo 视频申请，本期先跑通 Trial。

7. **<span style="font-size:18px;color:#fff">我们只申请"读"的权限——能看到你的用户名头像、你的画板列表、画板里的图片，不能替你发图、不能改你的账号。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">user_accounts:read（获取用户 Pinterest 用户名、头像）、boards:read（读取用户画板列表）、pins:read（读取画板下的 Pin 图片）</span>



***

## 3. OAuth 登录与授权流程

### 3.1 整体流程




```
用户点击「用 Pinterest 登录 / 连接 Pinterest」

&#x20; ↓

前端跳转到 Pinterest 授权页：

&#x20; https://www.pinterest.com/oauth/?client\_id={CLIENT\_ID}

&#x20;   \&redirect\_uri={REDIRECT\_URI}

&#x20;   \&response\_type=code

&#x20;   \&scope=user\_accounts:read,boards:read,pins:read

&#x20;   \&state={随机state}

&#x20; ↓

用户登录并点击「Allow」

&#x20; ↓

Pinterest 重定向回 /auth/pinterest/callback?code=xxx\&state=xxx

&#x20; ↓

后端用 code 换取 access\_token：

&#x20; POST https://api.pinterest.com/v5/oauth/token

&#x20; ↓

后端调用 GET /user\_account 获取用户信息

&#x20; ↓

后端在 Appwrite 中查找/创建用户记录，存储 pinterest\_access\_token

&#x20; ↓

前端跳转到素材库页面，触发首次同步
```

8. **<span style="font-size:18px;color:#fff">你点"连接Pinterest"，跳到Pinterest的授权页，登录后点"允许"，Pinterest就把你送回我们网站，系统在后台拿到你的访问凭证，然后自动把你的画板同步过来。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">用户点击「用 Pinterest 登录 / 连接 Pinterest」→ 前端跳转到 Pinterest 授权页 → 用户登录并点击「Allow」→ Pinterest 重定向回 /auth/pinterest/callback?code=xxx&state=xxx → 后端用 code 换取 access_token → 后端调用 GET /user_account 获取用户信息 → 后端在 Appwrite 中查找/创建用户记录，存储 pinterest_access_token → 前端跳转到素材库页面，触发首次同步</span>


### 3.2 State 参数




* 生成随机字符串，存在 sessionStorage 中

* 回调时校验 state 一致性，防止 CSRF

### 3.3 Token 存储




* Pinterest access\_token 有效期约 30 天

* 需要存 `refresh_token`（如果 OAuth 流程返回的话），过期时自动刷新

* Token 加密存储，不要明文暴露给前端

9. **<span style="font-size:18px;color:#fff">你的Pinterest访问凭证大概30天过期，系统会自动续期；凭证加密存在服务器上，不会露给你的浏览器。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">Pinterest access_token 有效期约 30 天；需要存 refresh_token（如果 OAuth 流程返回的话），过期时自动刷新；Token 加密存储，不要明文暴露给前端。</span>



***

## 4. 数据模型（Appwrite Collections）

### 4.1 新增 Collection：`pinterest_connections`

存储用户的 Pinterest 授权连接信息。




| 字段                  | 类型         | 说明                  |
| ------------------- | ---------- | ------------------- |
| user\_id            | string     | 关联 Appwrite 用户 ID   |
| pinterest\_username | string     | Pinterest 用户名       |
| pinterest\_image    | string     | Pinterest 头像 URL    |
| pinterest\_user\_id | string     | Pinterest 内部用户 ID   |
| access\_token       | string（加密） | OAuth access token  |
| refresh\_token      | string（加密） | OAuth refresh token |
| token\_expires\_at  | datetime   | token 过期时间          |
| last\_synced\_at    | datetime   | 上次同步时间              |
| created\_at         | datetime   | 创建时间                |
| updated\_at         | datetime   | 更新时间                |

10. **<span style="font-size:18px;color:#fff">系统给每个连接了Pinterest的用户建一条记录，记着你的Pinterest用户名、头像、访问凭证和上次同步时间。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">存储用户的 Pinterest 授权连接信息。</span>


### 4.2 新增 Collection：`pinterest_boards`

存储用户的画板列表。




| 字段                   | 类型       | 说明                       |
| -------------------- | -------- | ------------------------ |
| user\_id             | string   | 关联 Appwrite 用户 ID        |
| pinterest\_board\_id | string   | Pinterest 画板 ID          |
| name                 | string   | 画板名称                     |
| description          | string   | 画板描述（可为空）                |
| cover\_image\_url    | string   | 画板封面图 URL（Pinterest CDN） |
| pin\_count           | integer  | 画板内 Pin 数量               |
| is\_public           | boolean  | 是否公开                     |
| created\_at          | datetime |                          |
| updated\_at          | datetime |                          |

### 4.3 新增 Collection：`pinterest_pins`

存储画板下的 Pin 图片。




| 字段                   | 类型       | 说明                         |
| -------------------- | -------- | -------------------------- |
| user\_id             | string   | 关联 Appwrite 用户 ID          |
| board\_id            | string   | 关联 pinterest\_boards 文档 ID |
| pinterest\_pin\_id   | string   | Pinterest Pin ID           |
| title                | string   | Pin 标题（可为空）                |
| description          | string   | Pin 描述（可为空）                |
| image\_url\_original | string   | 原图 URL（Pinterest CDN）      |
| image\_url\_medium   | string   | 中等尺寸图 URL                  |
| image\_url\_small    | string   | 缩略图 URL                    |
| link                 | string   | Pin 跳转的原始链接（可为空）           |
| dominant\_color      | string   | 主色调（可选，用于筛选）               |
| created\_at          | datetime |                            |
| updated\_at          | datetime |                            |

### 4.4 存储策略




* **图片本体不下载**，只存 Pinterest CDN 上的图片 URL

* 前端直接 `<img src={image_url_medium}>` 展示

* Pinterest CDN 允许外链，无需代理

11. **<span style="font-size:18px;color:#fff">图片本身不下载到我们服务器，直接用Pinterest的图片地址展示，不用把图片再复制一份存过来。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">图片本体不下载，只存 Pinterest CDN 上的图片 URL；前端直接 <img src={image_url_medium}> 展示；Pinterest CDN 允许外链，无需代理。</span>



***

## 5. 后端 API 设计

后端入口：`scripts/deploy/api-server.mjs`

### 5.1 `GET /api/pinterest/auth/url`

获取 Pinterest 授权跳转地址。

**响应：**




```
{

&#x20; "authUrl": "https://www.pinterest.com/oauth/?..."

}
```

### 5.2 `GET /api/pinterest/auth/callback`

OAuth 回调接口，处理 code 换 token，创建 / 更新用户连接。

**参数：** `code`, `state`

**行为：**




1. 校验 state

2. 用 code 换 access\_token

3. 调 Pinterest `/user_account` 获取用户信息

4. 在 `pinterest_connections` 中 upsert 记录

5. 返回前端跳转地址（带登录态）

12. **<span style="font-size:18px;color:#fff">Pinterest把你送回来时，系统会先检查这是不是你本人发起的授权（防止别人冒充），然后用一次性凭证换到长期访问凭证，最后把你送回素材库页面。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">OAuth 回调接口，处理 code 换 token，创建 / 更新用户连接。</span>


### 5.3 `POST /api/pinterest/sync/boards`

触发同步用户的 Board 列表。

**行为：**




1. 用存储的 access\_token 调 Pinterest API：`GET /boards?page_size=25`

2. 分页拉取所有 board

3. upsert 到 `pinterest_boards` 集合

4. 更新 `last_synced_at`

**响应：**




```
{

&#x20; "boardsCount": 12,

&#x20; "boards": \[...]

}
```

### 5.4 `POST /api/pinterest/sync/pins/:boardId`

同步某个画板下的所有 Pin。

**行为：**




1. 调 Pinterest API：`GET /boards/{board_id}/pins?page_size=25`

2. 分页拉取，直到没有下一页

3. upsert 到 `pinterest_pins` 集合

4. 记录同步时间

### 5.5 `GET /api/pinterest/boards`

获取当前用户已同步的画板列表。

### 5.6 `GET /api/pinterest/pins?boardId=xxx&page=1&pageSize=50`

获取某个画板下的 Pin 列表（分页）。

### 5.7 `DELETE /api/pinterest/disconnect`

解除 Pinterest 连接，删除 token 数据（画板和 Pin 数据保留）。




***

## 6. 前端页面与交互

### 6.1 页面位置




* 素材库页面：`src/pages/account/pinterest/`（新建目录）

* 路由：`/account/pinterest`

### 6.2 页面状态

**状态一：未连接**




* 居中展示 Pinterest logo + 说明文案

* 一个「连接 Pinterest 账号」按钮

* 点击后跳转到 Pinterest 授权页

**状态二：已连接，未同步**




* 顶部显示用户头像 + Pinterest 用户名

* 一个「同步我的画板」大按钮

* 点击后开始同步，显示 loading

**状态三：同步中**




* 进度提示：「正在同步画板...」「正在同步 Pin（3/12）...」

* 禁用重复点击

**状态四：已同步**




* 左侧：画板列表（可折叠）

* 右侧：选中画板的 Pin 网格展示（瀑布流或网格）

* 每个 Pin 鼠标悬停显示：标题、原始链接、「在画布中使用」按钮

* 顶部：搜索框（按 Pin 标题 / 描述过滤）

* 右上角：「重新同步」按钮 + 「断开连接」按钮（需确认弹窗）

13. **<span style="font-size:18px;color:#fff">页面有四种状态——没连接时显示一个大按钮让你连；连了但没同步时显示"同步我的画板"按钮；同步中显示进度；同步完后左边是画板列表，右边是图片墙，还能搜索和重新同步。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">状态一：未连接（居中展示 Pinterest logo + 说明文案 + 连接按钮）；状态二：已连接未同步（顶部显示用户头像+用户名 + 同步按钮）；状态三：同步中（进度提示 + 禁用重复点击）；状态四：已同步（左侧画板列表 + 右侧 Pin 网格 + 搜索框 + 重新同步/断开连接按钮）。</span>


### 6.3 画布集成（后续）




* 画布里加一个「参考图」侧边 Tab

* 展示 Pinterest 素材库，拖拽图片到画布生成参考图层

* 本期先只做素材库页面，画布拖拽留到二期

### 6.4 UI 规则




* 遵守项目全局规则：**禁止描边**、**暗色主题**

* 组件用 Ant Design + Tailwind

* 加载状态用 Skeleton 或 Spin

* 断开连接必须有确认弹窗（项目规范要求）




***

## 7. Pinterest API 调用细节

### 7.1 基础信息




* Base URL：`https://api.pinterest.com/v5`

* 认证方式：Header `Authorization: Bearer {access_token}`

* 分页：响应中返回 `bookmark` 字段，下一页传 `bookmark` 参数

### 7.2 关键 Endpoint




| 用途        | Method | Path                      |
| --------- | ------ | ------------------------- |
| 获取当前用户    | GET    | `/user_account`           |
| 列出画板      | GET    | `/boards`                 |
| 列出画板下 Pin | GET    | `/boards/{board_id}/pins` |
| 刷新 token  | POST   | `/oauth/token`            |

### 7.3 速率限制




* Trial：1000 请求 / 天（全局限额）

* 同步时注意分页，每个 board 可能有几十上百个 pin

* 加简单的延时或并发控制，避免触发限流

14. **<span style="font-size:18px;color:#fff">试用期每天只能请求1000次，所以同步时要慢慢拉，一个画板可能有几百张图，不能一口气全要，不然会被Pinterest限流。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">Trial：1000 请求 / 天（全局限额）；同步时注意分页，每个 board 可能有几十上百个 pin；加简单的延时或并发控制，避免触发限流。</span>


### 7.4 错误处理




| HTTP 状态码 | 含义            | 处理                         |
| -------- | ------------- | -------------------------- |
| 401      | token 过期      | 自动用 refresh\_token 刷新，重试一次 |
| 403      | 权限不足          | 提示用户重新授权                   |
| 429      | 限流            | 指数退避重试                     |
| 404      | board/pin 不存在 | 跳过，记录日志                    |

15. **<span style="font-size:18px;color:#fff">访问凭证过期了系统自动换新的重试一次；权限不够会让你重新授权；请求太多被限流会等一会儿再试；图片不存在就跳过记个日志。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">401 token 过期 → 自动用 refresh_token 刷新，重试一次；403 权限不足 → 提示用户重新授权；429 限流 → 指数退避重试；404 board/pin 不存在 → 跳过，记录日志。</span>



***

## 8. 环境变量配置

后端需要新增环境变量：




```
PINTEREST\_CLIENT\_ID=你的client\_id

PINTEREST\_CLIENT\_SECRET=你的client\_secret

PINTEREST\_REDIRECT\_URI\_PROD=https://litzone.art/auth/pinterest/callback

PINTEREST\_REDIRECT\_URI\_DEV=http://localhost:5173/auth/pinterest/callback
```

前端需要：




```
VITE\_PINTEREST\_AUTH\_URL=https://www.pinterest.com/oauth/
```




***

## 9. 分期实施计划

### 第一期（本期）—— OAuth 登录 + 素材同步




1. 后端：OAuth 回调、token 管理、同步接口

2. Appwrite：创建 3 个 collection

3. 前端：素材库页面（连接状态、画板列表、Pin 网格）

4. Pinterest Developer App 申请与配置

### 第二期（后续）




* 画布侧边栏拖拽参考图

* Pin 搜索（按关键词过滤）

* Pinterest 图片代理（防盗链备用）

* 向 Pinterest 发布 Pin（写权限）

* 浏览器扩展灵感采集插件




***

## 10. 验收标准




* [ ] 用户能点击「连接 Pinterest」跳转到授权页

* [ ] 授权完成后自动跳回素材库页面

* [ ] 能看到自己 Pinterest 账号下的画板列表

* [ ] 点击某个画板能看到所有 Pin 图片缩略图

* [ ] 刷新页面后登录态保持，token 自动续期

* [ ] 断开连接有确认弹窗，断开后不再同步

* [ ] 暗色主题、无描边，与现有 UI 风格一致




***

## 11. 补充：开发注意事项（容易踩的坑）

### 11.1 图片尺寸选择

Pinterest API 返回的 Pin 图片是多尺寸对象，结构大致如下：




```
"media": {

&#x20; "images": {

&#x20;   "150x150": { "url": "...", "width": 150, "height": 150 },

&#x20;   "400x300": { "url": "...", "width": 400, "height": 300 },

&#x20;   "736x": { "url": "...", "width": 736, "height": 1104 },

&#x20;   "orig": { "url": "...", "width": 1080, "height": 1620 }

&#x20; }

}
```

**策略：**




* 列表缩略图用 `400x300` 或 `736x`，平衡清晰度和加载速度

* 点击大图预览时用 `orig` 原图

* 数据库里存 `medium`（736x）和 `original`（orig）两个 URL

### 11.2 非图片 Pin 的处理

不是所有 Pin 都是静态图片，Pinterest API 返回的 Pin 可能是：




* **静态图片 Pin**：正常展示

* **视频 Pin**：`media.media_type = "video"`，取封面图 `images.736x`，不展示视频播放

* **产品 Pin**：带商品信息，正常展示图片即可

* **轮播 Pin**：多张图，取第一张当封面

**处理原则：** 本期统一按图片展示，视频 / 产品 Pin 也只显示封面图，不做特殊交互。

### 11.3 私密画板（Secret Boards）




* Pinterest 的私密画板需要单独的 `boards:read_secret` 权限

* 默认 `boards:read` 只能读到公开画板

* 本期先只读公开画板，私密画板留到后续补充 scope

### 11.4 增量同步策略

不要每次同步都全量拉取，按以下逻辑：




| 场景          | 策略                                             |
| ----------- | ---------------------------------------------- |
| 首次同步        | 全量拉取所有 board 和 pin                             |
| 日常重新同步      | 只拉 board 列表（对比是否有新增 / 删除），已有 board 只拉最近修改的 pin |
| 单个 board 同步 | 分页拉取，按 `pinterest_pin_id` upsert，不重复插入         |

**本地删除策略：** 用户在 Pinterest 上删了 board/pin，本期**不自动删除本地数据**（避免误删），只是不再出现在同步结果里。二期再加 "清理已删除项" 功能。

16. **<span style="font-size:18px;color:#fff">第一次同步全量拉取，以后再同步只检查有没有新增或删除的画板，已有的画板只拉最近改过的图；你在Pinterest删了图，我们本地不自动删，只是不再显示，避免误删。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">首次同步全量拉取所有 board 和 pin；日常重新同步只拉 board 列表（对比是否有新增/删除），已有 board 只拉最近修改的 pin；单个 board 同步分页拉取，按 pinterest_pin_id upsert，不重复插入。本地删除策略：用户在 Pinterest 上删了 board/pin，本期不自动删除本地数据（避免误删），只是不再出现在同步结果里。</span>


### 11.5 本地开发回调问题

Pinterest 要求 Redirect URI 必须在 App 配置里白名单中，`http://localhost:5173` 也需要提前加进去。

**如果回调不通的备用方案：**




* 授权后 Pinterest 会跳到 [localhost](https://localhost)，即使前端没起来，地址栏里也有 `?code=xxx`

* 手动把 code 复制到后端测试接口里换 token 即可

* 或者用 ngrok /cloudflare tunnel 把本地服务暴露成 https 地址

### 11.6 性能与懒加载




* 一个画板可能有几百上千个 Pin，**不要一次性全部渲染**

* 前端用分页（每页 50 个）或虚拟滚动

* 图片用懒加载（`loading="lazy"`），进入视口才加载

* 缩略图用 `400x` 尺寸，不要直接加载原图

### 11.7 Token 安全




* `access_token` 和 `refresh_token` **绝对不能返回给前端**，只存在后端

* 后端响应给前端的是自己的 session 或 cookie，前端永远不接触 Pinterest token

* 加密存储：用环境变量里的密钥对称加密（AES）后再存 Appwrite，不要明文

17. **<span style="font-size:18px;color:#fff">你的Pinterest访问凭证绝对不能出现在浏览器里，只存在服务器上；浏览器拿到的是我们自己发的登录凭证，跟Pinterest访问凭证完全分开。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">access_token 和 refresh_token 绝对不能返回给前端，只存在后端；后端响应给前端的是自己的 session 或 cookie，前端永远不接触 Pinterest token；加密存储：用环境变量里的密钥对称加密（AES）后再存 Appwrite，不要明文。</span>


### 11.8 断开连接后的数据处理

用户点「断开连接」时：




* ✅ 删除 `pinterest_connections` 里的 token 记录（必须）

* ❓ `pinterest_boards` 和 `pinterest_pins` 里的已同步图片**暂时保留**，作为历史素材库

* 下次重新连接时，再全量同步覆盖

这样用户断开后之前同步的图还能看，不会一下清空。

### 11.9 多租户数据隔离




* 所有 collection 都必须带 `user_id` 字段

* Appwrite 权限设置为：**用户只能读 / 写自己的数据**

* 后端接口从登录态拿 `user_id`，不要相信前端传的 user\_id

18. **<span style="font-size:18px;color:#fff">每个用户只能看到自己同步的画板和图片，别人看不到你的；系统从你的登录状态识别你是谁，不会信你浏览器随便传的用户编号。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">所有 collection 都必须带 user_id 字段；Appwrite 权限设置为：用户只能读/写自己的数据；后端接口从登录态拿 user_id，不要相信前端传的 user_id。</span>


### 11.10 空状态与错误态

前端要处理这些边界情况：




* 用户 Pinterest 没有任何画板 → 提示「你还没有创建画板，去 Pinterest 看看吧」

* 画板里没有 Pin → 提示「这个画板是空的」

* 同步失败 → 显示错误原因 + 「重试」按钮

* 图片加载失败 → 显示占位图（默认缩略图）
