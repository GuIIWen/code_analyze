# 数据模型设计

## 1. 设计原则

- 一个仓库只建一个项目。
- 一个项目允许挂多个分支。
- 一个分支允许产生多次分析运行记录。
- 一份本地代码缓存由项目复用，不按分支重复 clone。
- 一份分析结果必须绑定到具体的分支和 commit。

## 2. 实体关系

```text
Project 1 --- N ProjectBranch 1 --- N AnalysisRun
        \
         \--- 1 RepoCache
```

## 3. projects

用于保存仓库级配置。

建议字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | integer | 主键 |
| `name` | text | 项目名称 |
| `git_url` | text | Git 仓库地址 |
| `default_branch` | text | 默认分支 |
| `local_repo_path` | text | 本地仓库缓存路径 |
| `status` | text | 项目状态 |
| `last_fetched_at` | datetime | 最近一次 fetch 时间 |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |

状态可选值：

- `active`
- `archived`
- `deleted`

说明：

- `name` 可由用户输入，也可首次根据仓库名生成。
- `local_repo_path` 只表示仓库缓存根目录，不表示某个分支的工作副本。

## 4. project_branches

用于保存项目下的分支级配置和最新状态。

建议字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | integer | 主键 |
| `project_id` | integer | 所属项目 |
| `branch_name` | text | 分支名 |
| `is_default` | boolean | 是否默认分析分支 |
| `analyzer_config_json` | text | 分支专属分析参数 |
| `last_commit_sha` | text | 最近一次成功分析的 commit |
| `last_run_id` | integer | 最近一次成功运行记录 |
| `last_result_path` | text | 最近一次成功结果文件路径 |
| `last_analyzed_at` | datetime | 最近一次成功分析时间 |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |

建议唯一约束：

- `(project_id, branch_name)`

说明：

- `analyzer_config_json` 可用于存放 `max_lines`、时间范围等可扩展参数。
- `last_result_path` 便于前端直接读取默认结果，不必每次查整张运行表。

## 5. analysis_runs

用于保存每次分析运行记录。

建议字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | integer | 主键 |
| `project_id` | integer | 所属项目 |
| `branch_id` | integer | 所属分支 |
| `trigger_type` | text | 触发方式 |
| `status` | text | 运行状态 |
| `cancel_requested` | boolean | 是否已请求取消 |
| `requested_ref` | text | 指定分析的 ref 或 commit |
| `commit_sha` | text | 本次分析 commit |
| `result_json_path` | text | JSON 结果路径 |
| `result_csv_path` | text | CSV 结果路径 |
| `error_message` | text | 错误信息 |
| `started_at` | datetime | 开始时间 |
| `finished_at` | datetime | 结束时间 |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |

`trigger_type` 建议值：

- `manual_update`
- `manual_reanalyze`
- `scheduled`
- `system_recover`

`status` 建议值：

- `queued`
- `cloning`
- `fetching`
- `analyzing`
- `succeeded`
- `failed`
- `canceled`

说明：

- `manual_update` 强调先检查远端更新，再决定是否执行分析。
- `manual_reanalyze` 强调即使 commit 未变化也可强制重新生成结果。
- `cancel_requested` 用于支持安全停止运行中的任务。

## 6. repo_cache

如果后续需要更强的缓存管理，可以单独建这张表；第一版也可并入 `projects`。

建议字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | integer | 主键 |
| `project_id` | integer | 所属项目 |
| `local_path` | text | 本地缓存目录 |
| `repo_size_bytes` | integer | 缓存大小 |
| `last_fetch_at` | datetime | 最近 fetch 时间 |
| `last_head_sha` | text | 最近获取到的 HEAD |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |

## 7. 结果文件结构

结果文件建议以 JSON 为主。

路径建议：

```text
storage/results/<project_id>/<safe_branch_name>/<run_id>.json
```

JSON 结构建议：

```json
{
  "project": {
    "id": 1,
    "name": "order-service",
    "git_url": "https://example.com/order-service.git"
  },
  "branch": {
    "name": "main"
  },
  "run": {
    "id": 1001,
    "status": "succeeded",
    "commit_sha": "abc123"
  },
  "summary": {
    "total_added": 0,
    "total_deleted": 0,
    "total_net": 0,
    "total_commits": 0,
    "author_count": 0
  },
  "monthly_trends": [],
  "group_stats": [],
  "project_stats": [],
  "author_project_stats": [],
  "records": []
}
```

说明：

- `records` 可对应前端当前使用的明细结构。
- `summary` 和聚合字段可以直接供看板消费，减少前端重复计算。

## 8. 分支分析与本地缓存关系

一个项目只保留一份仓库缓存，分支分析通过远端引用完成。

典型方式：

- `git fetch origin`
- `git log origin/main --numstat ...`
- `git log origin/release/1.2 --numstat ...`

分支发现策略：

- 创建项目时自动扫描远端分支并落库
- 手动同步项目时重新扫描远端分支
- 点击更新分析时也会先做一次远端分支同步

这样有几个好处：

- 避免每个分支单独 clone。
- 不依赖在工作区来回 `checkout`。
- 支持多个分支快速切换分析目标。

## 9. 删除策略的数据影响

### 9.1 删除分析记录

影响：

- 删除 `analysis_runs` 中目标记录。
- 删除对应结果文件。
- 不删除 `projects`、`project_branches` 和本地仓库缓存。

### 9.2 清理本地缓存

影响：

- 删除本地仓库目录。
- 清空 `projects.local_repo_path` 或更新 `repo_cache` 状态。
- 保留历史分析结果。

### 9.3 彻底删除项目

影响：

- 删除项目记录。
- 删除分支记录。
- 删除运行记录。
- 删除项目结果目录。
- 删除本地仓库缓存目录。

## 10. 兼容现有前端的数据映射

当前前端核心聚合结构可以迁移为后端输出字段：

| 当前前端概念 | 新结果字段 |
| --- | --- |
| `fullData` | `records` |
| `allMonths` | `summary.months` 或 `monthly_trends` 推导 |
| `allGroups` | `groups` |
| `groupStats` | `group_stats` |
| `projectStats` | `project_stats` |
| `authorProjectStats` | `author_project_stats` |

建议在后端直接生成这些聚合字段，降低前端改造成本。
