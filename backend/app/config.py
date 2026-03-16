from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
import os


@dataclass(frozen=True)
class Settings:
    repo_root: Path
    storage_dir: Path
    repos_dir: Path
    results_dir: Path
    database_path: Path
    git_bin: str
    default_max_lines: int


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    repo_root = Path(__file__).resolve().parents[2]
    storage_dir = Path(
        os.getenv("CODE_ANALYZE_STORAGE_DIR") or str(repo_root / "storage")
    )
    return Settings(
        repo_root=repo_root,
        storage_dir=storage_dir,
        repos_dir=storage_dir / "repos",
        results_dir=storage_dir / "results",
        database_path=storage_dir / "app.db",
        git_bin=os.getenv("CODE_ANALYZE_GIT_BIN", "git"),
        default_max_lines=int(os.getenv("CODE_ANALYZE_MAX_LINES", "2000")),
    )


def ensure_runtime_dirs(settings: Settings) -> None:
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    settings.repos_dir.mkdir(parents=True, exist_ok=True)
    settings.results_dir.mkdir(parents=True, exist_ok=True)

