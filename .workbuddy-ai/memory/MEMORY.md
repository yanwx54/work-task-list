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
- 任务数据：`work-tasks.v1`（结构：`{ version, tasks, purged }`，purged 是彻底删除墓碑 `{id: 删除时间}`）
- 界面偏好（视图/布局/筛选/排序/统计范围/主题）：`work-tasks.prefs.v1`
- 每日提醒状态（enabled / last 已提醒日期）：`work-tasks.remind.v1`
- 每日自动快照（保留 3 份）：`work-tasks.backup.v1`

## 核心设计决定（改动前先看）
- **默认首页 = 日历**（用户 2026-11-11 明确要求：首页月视图放任务，下一页才是列表）。
  日历状态：`state.calMonth`（'YYYY-MM'）+ `state.calSelDay`；日历下快添/新建默认落选中日。
- **「今天」清单 = 所有未完成 + 今日已完成**。这是用户明确要求的，别再改回"只看今天到期"。
- **删除 = 归档**（`archived`）。真要删才调 `deleteForever`，并写 `state.purged[id]` 墓碑。
- 所有统计/计数都要过滤 `!archived`，漏了就会出现归档后数字不降的 bug。
- 手动排序走 `task.order`，仅在 `sort==='manual'` 且列表视图下可拖。
- 打印走独立 `#printSheet` + `@media print`，不要试图用打印样式改造主界面。
- 新建任务必须调 `ensureNewVisible(t)`，否则在统计/归档/已完成视图里会"加了看不见"；
  搜索中新任务不命中关键词时它会清掉搜索。
- 抽屉里文本输入用 `refreshSoon()`（180ms 合并），别直接 `renderContent()`，任务多了会卡。
- **多标签页同步**：save() 写入前先 syncWithStore() 合并；storage 事件里 mergeRemote()。
  合并规则：同 id 取 updatedAt 新者；删除靠 purged 墓碑压制复活。**别再写回"整包覆盖"式 save**。
- **重复任务**：`task.repeat` ∈ REPEATS；完成本期调 spawnNextInstance 生成下一期，
  `task.nextId` 指向已生成的那条防止反复"完成/取消完成"刷任务；改周期时清 nextId。
- **批量选择**：state.sel(Set) + selAnchor + navId(键盘焦点)。批量用 bulkAction()，
  它会 quietOps++ 压住逐条 renderAll，结束统一刷一次。选择只在列表视图。
- **暗色模式**：颜色一律走 CSS 变量，禁止再写死 hex（本轮已把 100+ 处 token 化）。
  `applyTheme()` 设 `data-theme`，深色下 JS 内联的浅底色板靠 `[data-theme=dark]` + color-mix 兜底。
- **日历**：`calTasksByDay()` 只收未归档 + 有 due 的任务，**只铺在截止日**（曾做过"录入日→截止日
  全程铺展"，用户看后要求回退，2026-11-11 已恢复；别再往那个方向改）。拖色片 = 改 due，带撤销 toast。
  重复任务已完成且下一期未生成时铺未来 3 期**虚拟预览**（`data-virtual=1`，不可勾选/拖拽，
  点击打开真实本期）。日历视图下隐藏统计卡与工具栏（renderAll 的 isCal 分支）。
- **农历**：`lunarOf()` 基于 `Intl.DateTimeFormat('zh-CN-u-ca-chinese')`（浏览器内置，含闰月，零依赖），
  日名自己映射 LUNAR_DAY（初一显示月名）；节日 = LUNAR_FEST（农历）+ SOLAR_FEST（公历，公历优先），
  除夕特判（腊月廿九且次日正月初一）。`lunarCache` 每次 renderCalendarPanel 清空重算（42 格约 2ms）。
  Intl 不可用时整体静默降级。移动端只留节日。

## 自检方式
本机有 chromium（`C:/Users/yanwx/AppData/Local/ms-playwright/chromium-1200/chrome-win64/chrome.exe`）
和 `playwright-core`（装在 `C:/Users/yanwx/.workbuddy-ai/binaries/node/workspace/node_modules`），
用 `NODE_PATH` 指向它即可跑浏览器自动化。
**验证脚本要起本地 http server（file:// 下跨标签页 storage 事件不可靠），
path.resolve 后再 startsWith 校验目录，Windows 下 path.join 是反斜杠。**
脚本用完删掉，不留在项目里（.verify/ 已 gitignore）。

## ⚠️ 文件编辑铁律
**改源码只用 edit 工具。绝不用 PowerShell 的 Get-Content/Set-Content 读写含中文的文件**——
PowerShell 按 ANSI 码页读写，会整篇损坏 UTF-8（2026-11-11 实测把 app.js 全毁了）。
万一损坏：`cmd /c "git show HEAD:app.js > app.js"` 原始字节恢复（git checkout/restore 会被安全网拦）。
