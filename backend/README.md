# Backend

后端负责 Git 仓库接入、分支同步、分析任务执行和结果持久化。

## 运行方式

Python 命令统一使用这个虚拟环境：

```bash
source /root/Xpod_Web/xpod/bin/activate
```

开发启动：

```bash
source /root/Xpod_Web/xpod/bin/activate
uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8011 --reload
```

后台启动：

```bash
nohup setsid /root/Xpod_Web/xpod/bin/python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8011 </dev/null > /tmp/code-analyze-backend.log 2>&1 &
```

## 运行数据

默认存储目录在仓库根目录下的 `storage/`：

- `storage/app.db`
- `storage/repos/`
- `storage/results/`

可通过环境变量覆盖：

- `CODE_ANALYZE_STORAGE_DIR`
- `CODE_ANALYZE_GIT_BIN`
- `CODE_ANALYZE_MAX_LINES`

## 当前职责

- 项目管理
- 分支管理
- 远端分支同步
- 后台分析任务
- 任务取消与状态查询
- 本地代码缓存管理
- JSON 结果持久化

## 关键接口

- `GET /api/health`
- `POST /api/projects`
- `POST /api/projects/{project_id}/sync`
- `POST /api/projects/{project_id}/branches/{branch_id}/update`
- `POST /api/runs/{run_id}/cancel`
