# API 设计

## 1. 设计目标

- 前端只通过 API 管理项目、分支和分析任务。
- 前端服务模式不再直接读取本地 `data` 目录。
- 接口返回的数据应能直接支撑现有看板展示。

## 2. 基础约定

- Base Path: `/api`
- 返回格式：`application/json`
- 时间字段统一使用 ISO 8601
- 任务相关接口返回明确状态值，便于轮询

统一响应示例：

```json
{
  "success": true,
  "data": {}
}
```

失败示例：

```json
{
  "success": false,
  "error": {
    "code": "PROJECT_NOT_FOUND",
    "message": "project not found"
  }
}
```

## 3. 项目管理接口

### 3.1 新建项目

`POST /api/projects`

请求体：

```json
{
  "name": "order-service",
  "git_url": "https://example.com/order-service.git",
  "default_branch": "main"
}
```

返回：

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "order-service",
    "git_url": "https://example.com/order-service.git",
    "default_branch": "main",
    "status": "active",
    "default_branch_record": {
      "id": 11,
      "branch_name": "main",
      "is_default": true
    },
    "branches": [
      {
        "id": 11,
        "branch_name": "main",
        "is_default": true
      }
    ],
    "added_branches": [
      {
        "id": 11,
        "branch_name": "main",
        "is_default": true
      }
    ]
  }
}
```

说明：

- 创建项目时会尝试 clone 或 fetch 仓库并同步远端分支。
- 返回体会直接包含当前分支列表和默认分支记录。

### 3.2 查询项目列表

`GET /api/projects`

返回每个项目的摘要信息：

- 基础配置
- 分支数量
- 最近分析时间
- 最近状态

### 3.3 查询项目详情

`GET /api/projects/{project_id}`

返回：

- 项目配置
- 分支列表
- 最近运行记录摘要

### 3.4 更新项目配置

`PATCH /api/projects/{project_id}`

允许更新：

- `name`
- `default_branch`

原则：

- `git_url` 如需修改，应谨慎处理，避免和原缓存目录产生冲突。
- 第一版建议不支持直接修改 `git_url`，需要时走“新建项目”。

### 3.5 同步项目分支

`POST /api/projects/{project_id}/sync`

行为：

1. 对本地仓库执行 `fetch`；首次不存在时执行 `clone`
2. 重新扫描远端分支
3. 把新增分支写入数据库
4. 返回最新项目信息、分支列表和本次新增分支

用途：

- 项目创建后远端新增了分支
- 页面上需要手动刷新分支下拉
- 不想顺带触发分析

### 3.6 删除项目

`DELETE /api/projects/{project_id}`

Query 参数：

- `mode=full`

建议第一版只提供：

- `mode=full`，彻底删除项目及其本地缓存和结果。

## 4. 分支管理接口

### 4.1 新增分支

`POST /api/projects/{project_id}/branches`

请求体：

```json
{
  "branch_name": "release/1.2",
  "is_default": false,
  "analyzer_config": {
    "max_lines": 2000
  }
}
```

### 4.2 查询分支列表

`GET /api/projects/{project_id}/branches`

返回：

- 分支名
- 最近 commit
- 最近分析时间
- 最近状态

### 4.3 更新分支配置

`PATCH /api/projects/{project_id}/branches/{branch_id}`

允许更新：

- `is_default`
- `analyzer_config`

### 4.4 删除分支

`DELETE /api/projects/{project_id}/branches/{branch_id}`

默认行为：

- 删除分支元数据。
- 删除该分支的历史结果文件。
- 不删除项目本地仓库缓存。

## 5. 分析任务接口

### 5.1 更新并分析分支

`POST /api/projects/{project_id}/branches/{branch_id}/update`

请求体：

```json
{
  "force": false
}
```

行为：

1. 先同步项目远端分支，保证新增分支可见。
2. 检查本地仓库缓存。
3. 没有缓存则 clone。
4. 有缓存则 fetch。
5. 解析远端最新 commit。
6. 如 commit 未变化且 `force=false`，直接复用最近结果。
7. 否则创建新的分析任务。

返回：

```json
{
  "success": true,
  "data": {
    "project": {
      "id": 1,
      "name": "order-service"
    },
    "branches": [],
    "added_branches": [],
    "default_branch_record": {
      "id": 11,
      "branch_name": "main",
      "is_default": true
    },
    "run_id": 1001,
    "status": "queued"
  }
}
```

说明：

- 前端可直接根据返回体刷新项目和分支状态。
- 如果远端刚新增了分支，`added_branches` 会体现出来。

### 5.2 强制重新分析

`POST /api/projects/{project_id}/branches/{branch_id}/reanalyze`

请求体：

```json
{
  "commit_sha": "optional"
}
```

用途：

- 即使远端没有新提交，也重新生成一次结果。
- 适合分析参数变化后的重跑。

### 5.3 查询运行记录列表

`GET /api/projects/{project_id}/branches/{branch_id}/runs`

返回：

- 运行记录列表
- 状态
- commit
- 时间
- 是否为最近成功结果

### 5.4 查询单次运行状态

`GET /api/runs/{run_id}`

返回：

```json
{
  "success": true,
  "data": {
    "id": 1001,
    "status": "analyzing",
    "project_id": 1,
    "branch_id": 2,
    "commit_sha": "abc123",
    "error_message": null,
    "started_at": "2026-03-16T10:00:00Z",
    "finished_at": null
  }
}
```

### 5.5 停止运行中的任务

`POST /api/runs/{run_id}/cancel`

行为：

- 队列中的任务会直接标记为 `canceled`
- 执行中的任务会记录 `cancel_requested=true`，等待 Git/分析过程安全退出

### 5.6 查询单次运行结果

`GET /api/runs/{run_id}/result`

返回值应直接贴合看板数据结构。

### 5.6 查询分支最新结果

`GET /api/projects/{project_id}/branches/{branch_id}/result/latest`

用途：

- 页面初始化直接加载默认结果。
- 不必先查运行记录再二次请求。

## 6. 缓存管理接口

### 6.1 清理项目本地仓库缓存

`POST /api/projects/{project_id}/cache/clear`

行为：

- 删除本地仓库目录。
- 保留项目和历史结果。

### 6.2 查询缓存状态

`GET /api/projects/{project_id}/cache`

返回：

- 本地路径
- 是否存在
- 最近 fetch 时间
- 大小估算

## 7. 历史结果删除接口

### 7.1 删除一次分析结果

`DELETE /api/runs/{run_id}`

行为：

- 删除运行记录。
- 删除对应结果文件。

### 7.2 清理某分支历史结果

`POST /api/projects/{project_id}/branches/{branch_id}/runs/cleanup`

请求体：

```json
{
  "keep_latest": 5
}
```

## 8. 前端典型交互

### 8.1 新增项目并分析默认分支

1. `POST /api/projects`
2. `POST /api/projects/{project_id}/branches/{branch_id}/update`
3. 轮询 `GET /api/runs/{run_id}`
4. 完成后请求 `GET /api/runs/{run_id}/result`

### 8.2 打开项目详情页

1. `GET /api/projects/{project_id}`
2. `GET /api/projects/{project_id}/branches`
3. `GET /api/projects/{project_id}/branches/{branch_id}/result/latest`

### 8.3 删除项目

1. 用户确认彻底删除。
2. 调用 `DELETE /api/projects/{project_id}?mode=full`
3. 后端删除元数据、本地仓库和结果文件。

## 9. 与现有前端兼容的结果字段建议

为降低前端改造成本，`GET /api/runs/{run_id}/result` 和 `GET /result/latest` 建议直接返回：

```json
{
  "summary": {
    "totalAdded": 0,
    "totalDeleted": 0,
    "totalNet": 0,
    "totalCommits": 0,
    "authorCount": 0
  },
  "allMonths": [],
  "allGroups": [],
  "monthlyTrends": [],
  "groupMonthlyTrends": {},
  "groupStats": [],
  "projectStats": [],
  "authorProjectStats": [],
  "fullData": []
}
```

这样现有图表逻辑只需要把数据来源从本地文件解析切换到 API 即可。
