from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import sqlite3

from app.config import Settings


SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    git_url TEXT NOT NULL UNIQUE,
    default_branch TEXT NOT NULL,
    local_repo_path TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    last_fetched_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    branch_name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    analyzer_config_json TEXT NOT NULL DEFAULT '{}',
    last_commit_sha TEXT,
    last_run_id INTEGER,
    last_result_path TEXT,
    last_analyzed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(project_id, branch_name),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(last_run_id) REFERENCES analysis_runs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS analysis_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    trigger_type TEXT NOT NULL,
    status TEXT NOT NULL,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    requested_ref TEXT,
    commit_sha TEXT,
    result_json_path TEXT,
    result_csv_path TEXT,
    error_message TEXT,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(branch_id) REFERENCES project_branches(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_branches_project_id
    ON project_branches(project_id);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_branch_id
    ON analysis_runs(branch_id);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_project_id
    ON analysis_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_status
    ON analysis_runs(status);
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Repository:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.database_path = settings.database_path

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.database_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def initialize(self) -> None:
        with self.connection() as conn:
            conn.executescript(SCHEMA)
            self._ensure_analysis_runs_columns(conn)

    def _ensure_analysis_runs_columns(self, conn: sqlite3.Connection) -> None:
        columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(analysis_runs)").fetchall()
        }
        if "cancel_requested" not in columns:
            conn.execute(
                "ALTER TABLE analysis_runs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0"
            )

    def mark_incomplete_runs_failed(self) -> None:
        with self.connection() as conn:
            conn.execute(
                """
                UPDATE analysis_runs
                SET status = ?, error_message = ?, updated_at = ?, finished_at = ?
                WHERE status IN ('queued', 'cloning', 'fetching', 'analyzing')
                """,
                (
                    "failed",
                    "service restarted before the run finished",
                    utc_now(),
                    utc_now(),
                ),
            )

    def _project_repo_path(self, project_id: int) -> str:
        return str(self.settings.repos_dir / str(project_id) / "repo")

    def _row_to_dict(self, row: sqlite3.Row | None) -> dict | None:
        return dict(row) if row else None

    def create_project(self, name: str, git_url: str, default_branch: str) -> dict:
        timestamp = utc_now()
        with self.connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO projects (
                    name, git_url, default_branch, local_repo_path, status,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (name, git_url, default_branch, "", "active", timestamp, timestamp),
            )
            project_id = int(cursor.lastrowid)
            local_repo_path = self._project_repo_path(project_id)
            conn.execute(
                """
                UPDATE projects
                SET local_repo_path = ?, updated_at = ?
                WHERE id = ?
                """,
                (local_repo_path, timestamp, project_id),
            )
            row = conn.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
        return self._row_to_dict(row) or {}

    def list_projects(self) -> list[dict]:
        with self.connection() as conn:
            rows = conn.execute(
                """
                SELECT
                    p.*,
                    COUNT(b.id) AS branch_count,
                    MAX(b.last_analyzed_at) AS last_analyzed_at
                FROM projects p
                LEFT JOIN project_branches b ON b.project_id = p.id
                GROUP BY p.id
                ORDER BY p.created_at DESC
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def get_project(self, project_id: int) -> dict | None:
        with self.connection() as conn:
            row = conn.execute(
                """
                SELECT
                    p.*,
                    COUNT(b.id) AS branch_count,
                    MAX(b.last_analyzed_at) AS last_analyzed_at
                FROM projects p
                LEFT JOIN project_branches b ON b.project_id = p.id
                WHERE p.id = ?
                GROUP BY p.id
                """,
                (project_id,),
            ).fetchone()
        return self._row_to_dict(row)

    def update_project(self, project_id: int, **fields) -> dict | None:
        if not fields:
            return self.get_project(project_id)
        fields["updated_at"] = utc_now()
        assignments = ", ".join(f"{key} = ?" for key in fields)
        values = [fields[key] for key in fields] + [project_id]
        with self.connection() as conn:
            conn.execute(
                f"UPDATE projects SET {assignments} WHERE id = ?",
                values,
            )
        return self.get_project(project_id)

    def delete_project_record(self, project_id: int) -> None:
        with self.connection() as conn:
            conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))

    def create_branch(
        self,
        project_id: int,
        branch_name: str,
        is_default: bool,
        analyzer_config_json: str,
    ) -> dict:
        timestamp = utc_now()
        with self.connection() as conn:
            if is_default:
                conn.execute(
                    "UPDATE project_branches SET is_default = 0 WHERE project_id = ?",
                    (project_id,),
                )
            cursor = conn.execute(
                """
                INSERT INTO project_branches (
                    project_id, branch_name, is_default, analyzer_config_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    project_id,
                    branch_name,
                    int(is_default),
                    analyzer_config_json,
                    timestamp,
                    timestamp,
                ),
            )
            branch_id = int(cursor.lastrowid)
            row = conn.execute(
                "SELECT * FROM project_branches WHERE id = ?",
                (branch_id,),
            ).fetchone()
        return self._row_to_dict(row) or {}

    def list_branches(self, project_id: int) -> list[dict]:
        with self.connection() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM project_branches
                WHERE project_id = ?
                ORDER BY is_default DESC, branch_name ASC
                """,
                (project_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_branch(self, branch_id: int, project_id: int | None = None) -> dict | None:
        query = "SELECT * FROM project_branches WHERE id = ?"
        params: list[int] = [branch_id]
        if project_id is not None:
            query += " AND project_id = ?"
            params.append(project_id)
        with self.connection() as conn:
            row = conn.execute(query, params).fetchone()
        return self._row_to_dict(row)

    def get_default_branch(self, project_id: int) -> dict | None:
        with self.connection() as conn:
            row = conn.execute(
                """
                SELECT *
                FROM project_branches
                WHERE project_id = ?
                ORDER BY is_default DESC, created_at ASC
                LIMIT 1
                """,
                (project_id,),
            ).fetchone()
        return self._row_to_dict(row)

    def get_branch_by_name(self, project_id: int, branch_name: str) -> dict | None:
        with self.connection() as conn:
            row = conn.execute(
                """
                SELECT *
                FROM project_branches
                WHERE project_id = ? AND branch_name = ?
                LIMIT 1
                """,
                (project_id, branch_name),
            ).fetchone()
        return self._row_to_dict(row)

    def update_branch(
        self,
        branch_id: int,
        project_id: int,
        **fields,
    ) -> dict | None:
        if "is_default" in fields and fields["is_default"]:
            with self.connection() as conn:
                conn.execute(
                    "UPDATE project_branches SET is_default = 0 WHERE project_id = ?",
                    (project_id,),
                )
        if not fields:
            return self.get_branch(branch_id, project_id)
        fields["updated_at"] = utc_now()
        assignments = ", ".join(f"{key} = ?" for key in fields)
        values = [fields[key] for key in fields] + [branch_id, project_id]
        with self.connection() as conn:
            conn.execute(
                f"""
                UPDATE project_branches
                SET {assignments}
                WHERE id = ? AND project_id = ?
                """,
                values,
            )
        return self.get_branch(branch_id, project_id)

    def delete_branch_record(self, branch_id: int, project_id: int) -> None:
        with self.connection() as conn:
            conn.execute(
                "DELETE FROM project_branches WHERE id = ? AND project_id = ?",
                (branch_id, project_id),
            )

    def create_run(
        self,
        project_id: int,
        branch_id: int,
        trigger_type: str,
        requested_ref: str | None = None,
    ) -> dict:
        timestamp = utc_now()
        with self.connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO analysis_runs (
                    project_id, branch_id, trigger_type, status, cancel_requested,
                    requested_ref, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    project_id,
                    branch_id,
                    trigger_type,
                    "queued",
                    0,
                    requested_ref,
                    timestamp,
                    timestamp,
                ),
            )
            run_id = int(cursor.lastrowid)
            row = conn.execute(
                "SELECT * FROM analysis_runs WHERE id = ?",
                (run_id,),
            ).fetchone()
        return self._row_to_dict(row) or {}

    def get_run(self, run_id: int) -> dict | None:
        with self.connection() as conn:
            row = conn.execute(
                "SELECT * FROM analysis_runs WHERE id = ?",
                (run_id,),
            ).fetchone()
        return self._row_to_dict(row)

    def get_latest_active_run(self, branch_id: int) -> dict | None:
        with self.connection() as conn:
            row = conn.execute(
                """
                SELECT *
                FROM analysis_runs
                WHERE branch_id = ? AND status IN ('queued', 'cloning', 'fetching', 'analyzing')
                ORDER BY created_at DESC, id DESC
                LIMIT 1
                """,
                (branch_id,),
            ).fetchone()
        return self._row_to_dict(row)

    def list_runs(self, project_id: int, branch_id: int) -> list[dict]:
        with self.connection() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM analysis_runs
                WHERE project_id = ? AND branch_id = ?
                ORDER BY created_at DESC
                """,
                (project_id, branch_id),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_latest_success_run(self, branch_id: int) -> dict | None:
        with self.connection() as conn:
            row = conn.execute(
                """
                SELECT *
                FROM analysis_runs
                WHERE branch_id = ? AND status = 'succeeded'
                ORDER BY finished_at DESC, id DESC
                LIMIT 1
                """,
                (branch_id,),
            ).fetchone()
        return self._row_to_dict(row)

    def update_run(self, run_id: int, **fields) -> dict | None:
        if not fields:
            return self.get_run(run_id)
        fields["updated_at"] = utc_now()
        assignments = ", ".join(f"{key} = ?" for key in fields)
        values = [fields[key] for key in fields] + [run_id]
        with self.connection() as conn:
            conn.execute(
                f"UPDATE analysis_runs SET {assignments} WHERE id = ?",
                values,
            )
        return self.get_run(run_id)

    def delete_run_record(self, run_id: int) -> None:
        with self.connection() as conn:
            conn.execute("DELETE FROM analysis_runs WHERE id = ?", (run_id,))

    def request_run_cancel(self, run_id: int) -> dict | None:
        run = self.get_run(run_id)
        if not run:
            return None

        if run["status"] in ("succeeded", "failed", "canceled"):
            return run

        fields = {
            "cancel_requested": 1,
        }
        if run["status"] == "queued":
            fields["status"] = "canceled"
            fields["finished_at"] = utc_now()
            fields["error_message"] = "run canceled by user"
        return self.update_run(run_id, **fields)

    def refresh_branch_latest_success(self, branch_id: int, project_id: int) -> None:
        latest = self.get_latest_success_run(branch_id)
        payload = {
            "last_commit_sha": latest["commit_sha"] if latest else None,
            "last_run_id": latest["id"] if latest else None,
            "last_result_path": latest["result_json_path"] if latest else None,
            "last_analyzed_at": latest["finished_at"] if latest else None,
        }
        self.update_branch(branch_id, project_id, **payload)

    def list_runs_to_cleanup(self, branch_id: int, keep_latest: int) -> list[dict]:
        with self.connection() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM analysis_runs
                WHERE branch_id = ?
                ORDER BY created_at DESC
                LIMIT -1 OFFSET ?
                """,
                (branch_id, keep_latest),
            ).fetchall()
        return [dict(row) for row in rows]
