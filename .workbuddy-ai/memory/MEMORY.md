# Project10 个人工作任务清单 — 项目约定

## 定位
仿滴答清单的个人任务管理工具，围绕用户实际工作分四类：
**投标任务 / 售前支持 / 售后支持 / 其他支持**。

## 技术约定
- 纯前端单页，**零依赖、零构建**：`index.html` + `styles.css` + `app.js`
- 不使用框架、不引入 CDN（要能离线双击打开）
- 数据存 `localStorage`，键名 `work-tasks.v1`；结构变更时升版本号并做兼容读取
- 日期一律用本地时区字符串 `YYYY-MM-DD`，时间戳用 `Date.now()` 数字
- 配色：品牌红 `#E05A4E`；分类色 投标红 / 售前橙 / 售后蓝 / 其他紫

## 与 Project09 的区别
Project09 是 Flask + SQLite 的本地台账（重，带报表和工时统计）；
本项目是轻量任务清单（轻，能发布成静态链接）。两者不要混用技术栈。

## 发布与仓库
- 线上链接：https://dabd84272383481b8b1366507c453bc3.sg.agentos-app.run
- Git 仓库：https://github.com/yanwx54/work-task-list （public，main）
- 改动后在本地自检通过即重新发布，不用每次征求同意。
- ⚠️ 重新发布会换域名，旧链接失效；发完记得把新链接同步到用户和本文件。

## 数据键名
- 任务数据：`work-tasks.v1`
- 界面偏好（视图/布局/筛选/排序/统计范围）：`work-tasks.prefs.v1`
- 每日提醒状态（enabled / last 已提醒日期）：`work-tasks.remind.v1`
- 每日自动快照（保留 3 份）：`work-tasks.backup.v1`

## 核心设计决定（改动前先看）
- **今天视图 = 所有未完成 + 今日已完成**。这是用户明确要求的，别再改回"只看今天到期"。
- **删除 = 归档**（`archived`）。真要删才调 `deleteForever`。
- 所有统计/计数都要过滤 `!archived`，漏了就会出现归档后数字不降的 bug。
- 手动排序走 `task.order`，仅在 `sort==='manual'` 且列表视图下可拖。
- 打印走独立 `#printSheet` + `@media print`，不要试图用打印样式改造主界面。
- 新建任务必须调 `ensureNewVisible()`，否则在统计/归档/已完成视图里会"加了看不见"。
- 抽屉里文本输入用 `refreshSoon()`（180ms 合并），别直接 `renderContent()`，任务多了会卡。

## 自检方式
本机有 chromium（`C:/Users/yanwx/AppData/Local/ms-playwright/chromium-1200/chrome-win64/chrome.exe`）
和 `playwright-core`（装在 `C:/Users/yanwx/.workbuddy-ai/binaries/node/workspace/node_modules`），
用 `NODE_PATH` 指向它即可跑浏览器自动化。验证脚本用完删掉，不留在项目里。
