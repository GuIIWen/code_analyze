from __future__ import annotations

from pathlib import Path
import subprocess


class GitCommandError(RuntimeError):
    pass


def run_git_command(git_bin: str, args: list[str], cwd: Path | None = None) -> str:
    result = subprocess.run(
        [git_bin, *args],
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or "git command failed"
        raise GitCommandError(message)
    return result.stdout.strip()


def clone_repository(git_bin: str, git_url: str, target_path: Path) -> None:
    if target_path.exists():
        if (target_path / ".git").exists():
            return
        raise GitCommandError(f"cache path is not a git repository: {target_path}")
    target_path.parent.mkdir(parents=True, exist_ok=True)
    run_git_command(git_bin, ["clone", "--origin", "origin", git_url, str(target_path)])


def fetch_repository(git_bin: str, repo_path: Path) -> None:
    if not (repo_path / ".git").exists():
        raise GitCommandError(f"missing git metadata under {repo_path}")
    run_git_command(git_bin, ["fetch", "--prune", "origin"], cwd=repo_path)


def resolve_git_ref(git_bin: str, repo_path: Path, ref: str) -> str:
    return run_git_command(git_bin, ["rev-parse", ref], cwd=repo_path)


def directory_size_bytes(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for file_path in path.rglob("*"):
        if file_path.is_file():
            total += file_path.stat().st_size
    return total

