# 文档入口

打开下面的文件夹看就行。

1. **<span style="font-size:18px;color:#fff">这一堆文档讲的是整个网站怎么设计、怎么开发、怎么上线。不用从第一页读到最后一页，你现在想了解什么，就打开对应的文件夹。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">docs 目录入口，按文件夹分类阅读</span>


## 文件夹

2. **<span style="font-size:18px;color:#fff">想知道图存在哪、钱怎么扣、为什么这么设计，看这个文件夹。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">01-架构规范：技术规划、数据怎么流、为什么这么设计</span>


3. **<span style="font-size:18px;color:#fff">想在自己电脑上把网站跑起来、随便改也不影响真实用户，看这个文件夹。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">02-开发规范：怎么在自己电脑上跑起来</span>


4. **<span style="font-size:18px;color:#fff">想知道改好的东西怎么放到网上、让用户用上，看这个文件夹。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">03-部署规范：怎么上线</span>


5. **<span style="font-size:18px;color:#fff">想知道每个功能怎么用、会员有什么规矩、团队怎么共享，按编号顺序看，这是跟用户最相关的部分。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">04-需求规范：产品功能、业务规则（按编号顺序看）</span>


6. **<span style="font-size:18px;color:#fff">想看今天多少人访问、什么功能用得多、收了多少钱，看这个文件夹。</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">05-数据分析：看数据</span>


- **01-架构规范**：技术规划、数据怎么流、为什么这么设计
- **02-开发规范**：怎么在自己电脑上跑起来
- **03-部署规范**：怎么上线
- **04-需求规范**：产品功能、业务规则（按编号顺序看）
- **05-数据分析**：看数据

## 写白话的规矩（重要）

文档同时给两种"人"看：你看白话，AI 看专业内容。

### 白话怎么写

1. **从你日常使用的角度写**，不出现技术词。"Appwrite、数据库、文件存储、接口"这些一律不进白话，全部缩到下面小字里。
2. **每条专业内容都要配白话**，讲清楚：谁、做什么、结果是什么。
3. **难懂的规则才配例子，不要硬凑比喻**。能直接说清楚就直接说。只有确实绕的规则，才用你本来就熟悉的东西举例（比如"剩余额度"本来就是你天天看到的数字）。不要为了显得生动硬编"排练厅、后厨开火、门脸装上"这种比喻，反而更绕。
4. **不许写空泛词**。"同一件事""一个事实""相关数据"这种词你自己都看不懂，必须换成具体的东西（剩余额度、头像、订单）。
5. 写完自己读一遍，凡是卡住、要想一下才懂的，就重写。

### 排版格式

- **白话**：18px 加粗白色，是大字主体
- **专业**：极小灰字（用缩放做到约 4px），紧挨在白话下面，组内间距小
- **一组 = 一句白话 + 一句专业**，组与组之间空两行

白话写法模板：
```
1. **<span style="font-size:18px;color:#fff">用大白话+具体例子讲清楚</span>**<br>
   <span style="display:inline-block;font-size:12px;color:#666;transform:scale(0.35);transform-origin:left top;line-height:1">专业原文、表名、字段名、接口路径</span>
```

## 改动后怎么写入规范（必走流程）

每次改完东西，规范里**不能立刻**记，要等你验证过：

1. AI 改完一个东西，先问你一句："要不要写入规范？"
2. 你自己去测试、检查，确认没问题，回"可以写入"
3. AI 这才把这次做的事写进对应规范——白话大字给你看，专业小字给 AI 看
4. 测着有问题就先改，改好重新走一遍这个流程

这样规范里记的都是你验证过、确实能跑的东西，不会混进半成品。

## 总原则

所有文档**只许增加、不许减少**内容。可以整理、排版、加白话，但原来的每一段都要保留。
