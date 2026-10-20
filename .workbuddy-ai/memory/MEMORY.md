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

## 发布
线上链接：https://966a6c118047494f9fd049896f367839.sg.agentos-app.run
改动后在本地自检通过即重新发布，不用每次征求同意。

## 自检方式
本机有 chromium（`C:/Users/yanwx/AppData/Local/ms-playwright/chromium-1200/chrome-win64/chrome.exe`）
和 `playwright-core`（装在 `C:/Users/yanwx/.workbuddy-ai/binaries/node/workspace/node_modules`），
用 `NODE_PATH` 指向它即可跑浏览器自动化。验证脚本用完删掉，不留在项目里。
