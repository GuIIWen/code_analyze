from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
import json
import shutil

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import ensure_runtime_dirs, get_settings
from app.git_client import (
    GitCommandError,
    clone_repository,
    directory_size_bytes,
    fetch_repository,
    list_remote_branches,
    resolve_remote_head_branch,
)
from app.job_runner import (
    JobRunner,
    clear_project_cache,
    load_result_file,
    remove_project_storage,
    remove_run_artifacts,
    safe_branch_name,
)
from app.repository import Repository, utc_now
from app.schemas import (
    BranchCreate,
    BranchReanalyzeRequest,
    BranchUpdate,
    BranchUpdateRequest,
    CleanupRunsRequest,
    ProjectCreate,
    ProjectUpdate,
)


settings = get_settings()
repository = Repository(settings)
runner = JobRunner(settings, repository)


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_runtime_dirs(settings)
    repository.initialize()
    repository.mark_incomplete_runs_failed()
    runner.start()
    try:
        yield
    finally:
        runner.stop()


app = FastAPI(title="Code Analyze Service", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def success(data):
    return {"success": True, "data": data}


def api_error(status_code: int, code: str, message: str) -> None:
    raise HTTPException(status_code=status_code, detail={"code": code, "message": message})


def derive_project_name(git_url: str) -> str:
    name = git_url.rstrip("/").split("/")[-1]
    if name.endswith(".git"):
        name = name[:-4]
    return name or "project"


def serialize_project(project: dict) -> dict:
    return {
        "id": project["id"],
        "name": project["name"],
        "git_url": project["git_url"],
        "default_branch": project["default_branch"],
        "local_repo_path": project["local_repo_path"],
        "status": project["status"],
        "branch_count": project.get("branch_count", 0),
        "last_fetched_at": project.get("last_fetched_at"),
        "last_analyzed_at": project.get("last_analyzed_at"),
        "created_at": project["created_at"],
        "updated_at": project["updated_at"],
    }


def serialize_branch(branch: dict) -> dict:
    return {
        "id": branch["id"],
        "project_id": branch["project_id"],
        "branch_name": branch["branch_name"],
        "is_default": bool(branch["is_default"]),
        "analyzer_config": json.loads(branch.get("analyzer_config_json") or "{}"),
        "last_commit_sha": branch.get("last_commit_sha"),
        "last_run_id": branch.get("last_run_id"),
        "last_result_path": branch.get("last_result_path"),
        "last_analyzed_at": branch.get("last_analyzed_at"),
        "created_at": branch["created_at"],
        "updated_at": branch["updated_at"],
    }


def serialize_run(run: dict) -> dict:
    return {
        "id": run["id"],
        "project_id": run["project_id"],
        "branch_id": run["branch_id"],
        "trigger_type": run["trigger_type"],
        "status": run["status"],
        "cancel_requested": bool(run.get("cancel_requested")),
        "requested_ref": run.get("requested_ref"),
        "commit_sha": run.get("commit_sha"),
        "result_json_path": run.get("result_json_path"),
        "result_csv_path": run.get("result_csv_path"),
        "error_message": run.get("error_message"),
        "started_at": run.get("started_at"),
        "finished_at": run.get("finished_at"),
        "created_at": run["created_at"],
        "updated_at": run["updated_at"],
    }


def get_project_or_404(project_id: int) -> dict:
    project = repository.get_project(project_id)
    if not project:
        api_error(404, "PROJECT_NOT_FOUND", "project not found")
    return project


def get_branch_or_404(project_id: int, branch_id: int) -> dict:
    branch = repository.get_branch(branch_id, project_id)
    if not branch:
        api_error(404, "BRANCH_NOT_FOUND", "branch not found")
    return branch


def get_run_or_404(run_id: int) -> dict:
    run = repository.get_run(run_id)
    if not run:
        api_error(404, "RUN_NOT_FOUND", "run not found")
    return run


def enqueue_run(project_id: int, branch_id: int, trigger_type: str, requested_ref: str | None = None) -> dict:
    run = repository.create_run(project_id, branch_id, trigger_type, requested_ref=requested_ref)
    runner.enqueue(run["id"])
    return run


def sync_project_branches(project: dict, preferred_default_branch: str | None = None) -> tuple[list[dict], dict]:
    repo_path = Path(project["local_repo_path"])
    if repo_path.exists():
        fetch_repository(settings.git_bin, repo_path)
    else:
        clone_repository(settings.git_bin, project["git_url"], repo_path)

    remote_branches = list_remote_branches(settings.git_bin, repo_path)
    if not remote_branches:
        api_error(400, "NO_REMOTE_BRANCHES", "no remote branches found for this repository")

    default_branch_name = preferred_default_branch if preferred_default_branch in remote_branches else None
    if default_branch_name is None:
        default_branch_name = resolve_remote_head_branch(settings.git_bin, repo_path)
    if default_branch_name is None or default_branch_name not in remote_branches:
        default_branch_name = remote_branches[0]

    for branch_name in remote_branches:
        existing = repository.get_branch_by_name(project["id"], branch_name)
        if existing:
            if branch_name == default_branch_name and not bool(existing["is_default"]):
                repository.update_branch(existing["id"], project["id"], is_default=True)
            continue
        repository.create_branch(
            project["id"],
            branch_name,
            branch_name == default_branch_name,
            json.dumps({}, ensure_ascii=False),
        )

    repository.update_project(
        project["id"],
        default_branch=default_branch_name,
        last_fetched_at=utc_now(),
    )
    branches = repository.list_branches(project["id"])
    default_branch = next((branch for branch in branches if bool(branch["is_default"])), None)
    if default_branch is None:
        api_error(500, "DEFAULT_BRANCH_MISSING", "default branch was not resolved after sync")
    return branches, default_branch


@app.exception_handler(HTTPException)
async def handle_http_exception(_: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "HTTP_ERROR", "message": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content={"success": False, "error": detail})


@app.exception_handler(GitCommandError)
async def handle_git_exception(_: Request, exc: GitCommandError):
    return JSONResponse(
        status_code=400,
        content={"success": False, "error": {"code": "GIT_ERROR", "message": str(exc)}},
    )


@app.get("/api/health")
async def health():
    return success({"status": "ok"})


@app.post("/api/projects")
async def create_project(payload: ProjectCreate):
    project_name = payload.name or derive_project_name(payload.git_url)
    project: dict | None = None
    try:
        project = repository.create_project(project_name, payload.git_url, payload.default_branch)
        _, branch = sync_project_branches(project, payload.default_branch)
    except Exception as exc:
        if project is not None:
            remove_project_storage(settings, project)
            repository.delete_project_record(project["id"])
        if "UNIQUE constraint failed: projects.git_url" in str(exc):
            api_error(409, "PROJECT_EXISTS", "project already exists")
        raise
    data = serialize_project(project)
    data["default_branch_record"] = serialize_branch(branch)
    return success(data)


@app.get("/api/projects")
async def list_projects():
    return success([serialize_project(project) for project in repository.list_projects()])


@app.get("/api/projects/{project_id}")
async def get_project(project_id: int):
    project = get_project_or_404(project_id)
    branches = repository.list_branches(project_id)
    recent_runs = []
    for branch in branches:
        latest = repository.get_latest_active_run(branch["id"]) or repository.get_latest_success_run(branch["id"])
        if latest:
            recent_runs.append(serialize_run(latest))
    return success(
        {
            "project": serialize_project(project),
            "branches": [serialize_branch(branch) for branch in branches],
            "recent_runs": recent_runs,
        }
    )


@app.patch("/api/projects/{project_id}")
async def update_project(project_id: int, payload: ProjectUpdate):
    get_project_or_404(project_id)
    updates = payload.model_dump(exclude_unset=True)
    if "default_branch" in updates:
        branch = repository.get_branch_by_name(project_id, updates["default_branch"])
        if branch:
            repository.update_branch(branch["id"], project_id, is_default=True)
    project = repository.update_project(project_id, **updates)
    return success(serialize_project(project))


@app.delete("/api/projects/{project_id}")
async def delete_project(
    project_id: int,
    mode: Literal["full"] = Query("full"),
):
    project = get_project_or_404(project_id)
    if mode != "full":
        api_error(400, "UNSUPPORTED_DELETE_MODE", "only full delete is supported")
    remove_project_storage(settings, project)
    repository.delete_project_record(project_id)
    return success({"deleted": True})


@app.post("/api/projects/{project_id}/branches")
async def create_branch(project_id: int, payload: BranchCreate):
    get_project_or_404(project_id)
    try:
        branch = repository.create_branch(
            project_id,
            payload.branch_name,
            payload.is_default,
            json.dumps(payload.analyzer_config, ensure_ascii=False),
        )
    except Exception as exc:
        if "UNIQUE constraint failed: project_branches.project_id, project_branches.branch_name" in str(exc):
            api_error(409, "BRANCH_EXISTS", "branch already exists")
        raise
    if bool(branch["is_default"]):
        repository.update_project(project_id, default_branch=branch["branch_name"])
    return success(serialize_branch(branch))


@app.get("/api/projects/{project_id}/branches")
async def list_branches(project_id: int):
    get_project_or_404(project_id)
    return success([serialize_branch(branch) for branch in repository.list_branches(project_id)])


@app.patch("/api/projects/{project_id}/branches/{branch_id}")
async def update_branch(project_id: int, branch_id: int, payload: BranchUpdate):
    branch = get_branch_or_404(project_id, branch_id)
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("is_default") is False and bool(branch["is_default"]):
        api_error(
            400,
            "DEFAULT_BRANCH_REQUIRED",
            "set another branch as default before unsetting the current one",
        )
    if "analyzer_config" in updates:
        updates["analyzer_config_json"] = json.dumps(updates.pop("analyzer_config"), ensure_ascii=False)
    updated = repository.update_branch(branch["id"], project_id, **updates)
    if bool(updated["is_default"]):
        repository.update_project(project_id, default_branch=updated["branch_name"])
    return success(serialize_branch(updated))


@app.delete("/api/projects/{project_id}/branches/{branch_id}")
async def delete_branch(project_id: int, branch_id: int):
    branch = get_branch_or_404(project_id, branch_id)
    if len(repository.list_branches(project_id)) == 1:
        api_error(400, "LAST_BRANCH", "cannot delete the last branch")
    runs = repository.list_runs(project_id, branch_id)
    for run in runs:
        remove_run_artifacts(run)
    branch_results_dir = settings.results_dir / str(project_id) / safe_branch_name(branch["branch_name"])
    if branch_results_dir.exists():
        shutil.rmtree(branch_results_dir)
    repository.delete_branch_record(branch_id, project_id)
    if bool(branch["is_default"]):
        next_default = repository.get_default_branch(project_id)
        if next_default:
            repository.update_project(project_id, default_branch=next_default["branch_name"])
    return success({"deleted": True})


@app.post("/api/projects/{project_id}/branches/{branch_id}/update")
async def update_branch_run(project_id: int, branch_id: int, payload: BranchUpdateRequest):
    get_project_or_404(project_id)
    get_branch_or_404(project_id, branch_id)
    trigger_type = "manual_reanalyze" if payload.force else "manual_update"
    run = enqueue_run(project_id, branch_id, trigger_type)
    return success({"run_id": run["id"], "status": run["status"]})


@app.post("/api/projects/{project_id}/branches/{branch_id}/reanalyze")
async def reanalyze_branch(project_id: int, branch_id: int, payload: BranchReanalyzeRequest):
    get_project_or_404(project_id)
    get_branch_or_404(project_id, branch_id)
    run = enqueue_run(project_id, branch_id, "manual_reanalyze", requested_ref=payload.commit_sha)
    return success({"run_id": run["id"], "status": run["status"]})


@app.get("/api/projects/{project_id}/branches/{branch_id}/runs")
async def list_runs(project_id: int, branch_id: int):
    get_project_or_404(project_id)
    get_branch_or_404(project_id, branch_id)
    return success([serialize_run(run) for run in repository.list_runs(project_id, branch_id)])


@app.post("/api/projects/{project_id}/branches/{branch_id}/runs/cleanup")
async def cleanup_runs(project_id: int, branch_id: int, payload: CleanupRunsRequest):
    branch = get_branch_or_404(project_id, branch_id)
    keep_latest = max(0, payload.keep_latest)
    removable_runs = repository.list_runs_to_cleanup(branch_id, keep_latest)
    for run in removable_runs:
        remove_run_artifacts(run)
        repository.delete_run_record(run["id"])
    repository.refresh_branch_latest_success(branch["id"], project_id)
    return success({"deleted_runs": [run["id"] for run in removable_runs]})


@app.get("/api/projects/{project_id}/branches/{branch_id}/result/latest")
async def get_latest_result(project_id: int, branch_id: int):
    get_project_or_404(project_id)
    branch = get_branch_or_404(project_id, branch_id)
    result = load_result_file(branch.get("last_result_path"))
    if result is None:
        api_error(404, "RESULT_NOT_FOUND", "latest result not found")
    return success(result)


@app.get("/api/runs/{run_id}")
async def get_run(run_id: int):
    return success(serialize_run(get_run_or_404(run_id)))


@app.post("/api/runs/{run_id}/cancel")
async def cancel_run(run_id: int):
    run = get_run_or_404(run_id)
    if run["status"] in ("succeeded", "failed", "canceled"):
        api_error(409, "RUN_NOT_ACTIVE", "run is not active")
    updated = repository.request_run_cancel(run_id)
    if updated is None:
        api_error(404, "RUN_NOT_FOUND", "run not found")
    return success(serialize_run(updated))


@app.get("/api/runs/{run_id}/result")
async def get_run_result(run_id: int):
    run = get_run_or_404(run_id)
    result = load_result_file(run.get("result_json_path"))
    if result is None:
        api_error(404, "RESULT_NOT_FOUND", "run result not found")
    return success(result)


@app.delete("/api/runs/{run_id}")
async def delete_run(run_id: int):
    run = get_run_or_404(run_id)
    remove_run_artifacts(run)
    repository.delete_run_record(run_id)
    repository.refresh_branch_latest_success(run["branch_id"], run["project_id"])
    return success({"deleted": True})


@app.post("/api/projects/{project_id}/cache/clear")
async def clear_cache(project_id: int):
    project = get_project_or_404(project_id)
    clear_project_cache(project)
    return success({"cleared": True})


@app.get("/api/projects/{project_id}/cache")
async def get_cache(project_id: int):
    project = get_project_or_404(project_id)
    repo_path = Path(project["local_repo_path"])
    return success(
        {
            "local_repo_path": project["local_repo_path"],
            "exists": repo_path.exists(),
            "size_bytes": directory_size_bytes(repo_path),
            "last_fetched_at": project.get("last_fetched_at"),
        }
    )
