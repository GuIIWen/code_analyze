from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from queue import Queue
from threading import Event, Thread
import json
import shutil

from app.analyzer.git_analyzer import analyze_git_reference
from app.config import Settings
from app.git_client import (
    GitCommandError,
    clone_repository,
    fetch_repository,
    resolve_git_ref,
)
from app.repository import Repository, utc_now


@dataclass
class QueuedRun:
    run_id: int


def safe_branch_name(branch_name: str) -> str:
    return branch_name.replace("/", "_").replace("\\", "_").replace(" ", "_")


def branch_max_lines(branch: dict, default_max_lines: int) -> int:
    raw = branch.get("analyzer_config_json") or "{}"
    try:
        config = json.loads(raw)
    except json.JSONDecodeError:
        config = {}
    value = config.get("max_lines", default_max_lines)
    try:
        return int(value)
    except (TypeError, ValueError):
        return default_max_lines


def result_path_for_run(settings: Settings, project_id: int, branch_name: str, run_id: int) -> Path:
    return settings.results_dir / str(project_id) / safe_branch_name(branch_name) / f"{run_id}.json"


def load_result_file(path: str | None) -> dict | None:
    if not path:
        return None
    file_path = Path(path)
    if not file_path.exists():
        return None
    return json.loads(file_path.read_text(encoding="utf-8"))


def remove_run_artifacts(run: dict) -> None:
    for key in ("result_json_path", "result_csv_path"):
        value = run.get(key)
        if value:
            file_path = Path(value)
            if file_path.exists():
                file_path.unlink()


def clear_project_cache(project: dict) -> None:
    repo_path = Path(project["local_repo_path"])
    if repo_path.exists():
        shutil.rmtree(repo_path)


def remove_project_storage(settings: Settings, project: dict) -> None:
    clear_project_cache(project)
    results_dir = settings.results_dir / str(project["id"])
    if results_dir.exists():
        shutil.rmtree(results_dir)


class JobRunner:
    def __init__(self, settings: Settings, repository: Repository) -> None:
        self.settings = settings
        self.repository = repository
        self._queue: Queue[QueuedRun | None] = Queue()
        self._stop_event = Event()
        self._thread = Thread(target=self._worker, name="analysis-job-runner", daemon=True)

    def start(self) -> None:
        if not self._thread.is_alive():
            self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._queue.put(None)
        self._thread.join(timeout=5)

    def enqueue(self, run_id: int) -> None:
        self._queue.put(QueuedRun(run_id=run_id))

    def _worker(self) -> None:
        while not self._stop_event.is_set():
            item = self._queue.get()
            if item is None:
                self._queue.task_done()
                return
            try:
                self._process_run(item.run_id)
            finally:
                self._queue.task_done()

    def _process_run(self, run_id: int) -> None:
        run = self.repository.get_run(run_id)
        if not run:
            return
        project = self.repository.get_project(run["project_id"])
        branch = self.repository.get_branch(run["branch_id"], run["project_id"])
        if not project or not branch:
            self.repository.update_run(
                run_id,
                status="failed",
                error_message="missing project or branch metadata",
                finished_at=utc_now(),
            )
            return

        started_at = utc_now()
        self.repository.update_run(run_id, status="cloning", started_at=started_at, error_message=None)

        repo_path = Path(project["local_repo_path"])

        try:
            if repo_path.exists():
                self.repository.update_run(run_id, status="fetching")
                fetch_repository(self.settings.git_bin, repo_path)
            else:
                clone_repository(self.settings.git_bin, project["git_url"], repo_path)

            self.repository.update_project(project["id"], last_fetched_at=utc_now())

            requested_ref = run.get("requested_ref")
            target_ref = requested_ref or f"origin/{branch['branch_name']}"
            commit_sha = resolve_git_ref(self.settings.git_bin, repo_path, target_ref)

            latest_success = self.repository.get_latest_success_run(branch["id"])
            can_reuse = (
                requested_ref is None
                and run["trigger_type"] != "manual_reanalyze"
                and latest_success
                and latest_success.get("commit_sha") == commit_sha
                and latest_success.get("result_json_path")
                and Path(latest_success["result_json_path"]).exists()
            )
            if can_reuse:
                finished_at = utc_now()
                self.repository.update_run(
                    run_id,
                    status="succeeded",
                    commit_sha=commit_sha,
                    result_json_path=latest_success["result_json_path"],
                    result_csv_path=latest_success.get("result_csv_path"),
                    finished_at=finished_at,
                )
                self.repository.update_branch(
                    branch["id"],
                    project["id"],
                    last_commit_sha=commit_sha,
                    last_run_id=run_id,
                    last_result_path=latest_success["result_json_path"],
                    last_analyzed_at=finished_at,
                )
                return

            self.repository.update_run(run_id, status="analyzing", commit_sha=commit_sha)

            result = analyze_git_reference(
                git_bin=self.settings.git_bin,
                repo_path=repo_path,
                ref=target_ref,
                group_name=project["name"],
                project_name=project["name"],
                branch_name=branch["branch_name"],
                commit_sha=commit_sha,
                run_id=run_id,
                max_lines=branch_max_lines(branch, self.settings.default_max_lines),
            )

            result["projectMeta"].update(
                {
                    "id": project["id"],
                    "gitUrl": project["git_url"],
                }
            )

            output_path = result_path_for_run(
                self.settings,
                project["id"],
                branch["branch_name"],
                run_id,
            )
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(
                json.dumps(result, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            finished_at = utc_now()
            self.repository.update_run(
                run_id,
                status="succeeded",
                commit_sha=commit_sha,
                result_json_path=str(output_path),
                finished_at=finished_at,
                error_message=None,
            )
            self.repository.update_branch(
                branch["id"],
                project["id"],
                last_commit_sha=commit_sha,
                last_run_id=run_id,
                last_result_path=str(output_path),
                last_analyzed_at=finished_at,
            )
        except GitCommandError as exc:
            self.repository.update_run(
                run_id,
                status="failed",
                error_message=str(exc),
                finished_at=utc_now(),
            )
        except Exception as exc:
            self.repository.update_run(
                run_id,
                status="failed",
                error_message=str(exc),
                finished_at=utc_now(),
            )

