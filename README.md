# 研发效能代码分析服务

这是一个以 Git 仓库为输入的研发效能分析服务。输入仓库地址后，系统会自动拉取代码、发现远端分支、执行分析，并把结果持久化到本地，前端看板直接消费后端结果。

当前产品有两个模式：

- `服务模式`
  - 主模式。通过 Git 地址创建项目，管理分支，触发更新分析，查看任务状态和最新结果。
- `CSV 模式`
  - 兼容模式。保留本地 CSV 导入与展示能力，方便继续复用旧数据。

## 当前能力

- 输入 Git 地址后自动创建项目并同步远端分支
- 一个仓库对应一个项目，一个项目下管理多个分支
- 点击 `更新分析` 时自动 `fetch` 并重新同步远端分支
- 支持单独点击 `同步项目分支`，不跑分析也能刷新分支列表
- 后端后台执行分析任务，页面刷新后可继续轮询已有任务
- 支持停止分析、清理本地缓存、删除项目数据
- 结果持久化到 `storage/`，页面刷新后可直接读取最近结果

## 运行环境

- Node.js 18+
- Git
- Python 虚拟环境：`/root/Xpod_Web/xpod/bin/python`
- Python 包需安装在上述虚拟环境中；缺包时在该虚拟环境里补装

## 快速启动

首次安装前端依赖：

```bash
npm install
```

启动前后端服务：

```bash
./scripts/restart_services.sh
```

默认端口：

- 前端：`3199`
- 后端：`8011`

常用运维脚本：

```bash
./scripts/status_services.sh
./scripts/stop_services.sh
```

日志文件：

- 后端：`/tmp/code-analyze-backend.log`
- 前端：`/tmp/code-analyze-frontend.log`

## 手工启动

后端：

```bash
nohup setsid /root/Xpod_Web/xpod/bin/python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8011 </dev/null > /tmp/code-analyze-backend.log 2>&1 &
```

前端：

```bash
nohup setsid npm run dev </dev/null > /tmp/code-analyze-frontend.log 2>&1 &
```

说明：

- `vite.config.ts` 默认监听 `3199`
- 前端 `/api` 会代理到 `http://127.0.0.1:8011`

## 数据存储

运行时数据位于 `storage/`：

```text
storage/
├── app.db
├── repos/
│   └── <project_id>/repo
└── results/
    └── <project_id>/<safe_branch_name>/<run_id>.json
```

持久化策略：

- 仓库代码缓存和分析结果分离存储
- 一个项目只保留一份本地 Git 缓存
- 每次分析生成一份独立 JSON 结果文件
- 删除项目时同时删除本地缓存、结果文件和数据库记录

## 典型流程

1. 在前端 `服务模式` 中输入 Git 地址创建项目
2. 系统自动拉取仓库并发现远端分支
3. 选择分支后点击 `更新分析`
4. 如远端新增分支，可点击 `同步项目分支` 或再次执行 `更新分析`
5. 分析完成后直接在看板查看最新结果

## 开发校验

后端静态校验：

```bash
source /root/Xpod_Web/xpod/bin/activate
python -m compileall backend
```

前端构建校验：

```bash
npm run build
```

## 目录说明

```text
code_analyze/
├── backend/                  # FastAPI 后端
├── docs/                     # 设计与部署文档
├── scripts/                  # 启停与状态脚本
├── src/                      # React 前端
├── analyze_repos.py          # 旧版离线 CSV 分析脚本
├── author_mapping.json       # 作者映射
└── storage/                  # 运行时数据
```

## 历史兼容说明

- `analyze_repos.py` 和 `CSV 模式` 仍可继续使用
- `start_dashboard.bat`、`start_dashboard_for_win11.bat` 属于旧版本地 CSV 启动方式，不再是当前主路径
- 当前主路径是 `Git 服务模式 + 后端持久化`
