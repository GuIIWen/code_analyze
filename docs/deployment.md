# 部署说明

## 1. 当前部署形态

当前项目采用单机部署：

- 前端：Vite dev server
- 后端：FastAPI + Uvicorn
- 数据：SQLite + 本地文件

默认端口：

- 前端 `3199`
- 后端 `8011`

## 2. 前置条件

- 已安装 Node.js 18+
- 已安装 Git
- Python 依赖安装在 `/root/Xpod_Web/xpod/` 虚拟环境中

## 3. 启停脚本

项目内置脚本：

- `scripts/restart_services.sh`
  - 停掉旧服务并重新启动前后端
- `scripts/stop_services.sh`
  - 停止前后端服务
- `scripts/status_services.sh`
  - 查看端口占用、后端健康检查和日志位置

## 4. 启动方式

```bash
./scripts/restart_services.sh
```

启动后访问：

- `http://127.0.0.1:3199`

## 5. 手工命令

后端：

```bash
nohup setsid /root/Xpod_Web/xpod/bin/python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8011 </dev/null > /tmp/code-analyze-backend.log 2>&1 &
```

前端：

```bash
nohup setsid npm run dev </dev/null > /tmp/code-analyze-frontend.log 2>&1 &
```

## 6. 日志与数据

日志：

- `/tmp/code-analyze-backend.log`
- `/tmp/code-analyze-frontend.log`

运行数据：

- `storage/app.db`
- `storage/repos/`
- `storage/results/`

## 7. 日常运维

查看状态：

```bash
./scripts/status_services.sh
```

停止服务：

```bash
./scripts/stop_services.sh
```

后端校验：

```bash
source /root/Xpod_Web/xpod/bin/activate
python -m compileall backend
```

前端校验：

```bash
npm run build
```

## 8. 当前约束

- 前端当前仍使用 Vite dev server，不是独立静态文件部署
- 适合单机或轻量内网部署
- 私有仓库认证、定时任务和多实例调度尚未做
