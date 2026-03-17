from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
import subprocess
import uuid
import shutil
import time


class GitCommandError(RuntimeError):
    pass


class GitCommandCanceled(GitCommandError):
    pass


CancelCheck = Callable[[], bool]


def run_git_command(
    git_bin: str,
    args: list[str],
    cwd: Path | None = None,
    cancel_check: CancelCheck | None = None,
) -> str:
    if cancel_check and cancel_check():
        raise GitCommandCanceled("run canceled by user")

    process = subprocess.Popen(
        [git_bin, *args],
        cwd=str(cwd) if cwd else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    while True:
        return_code = process.poll()
        if return_code is not None:
            stdout, stderr = process.communicate()
            if return_code != 0:
                message = stderr.strip() or stdout.strip() or "git command failed"
                raise GitCommandError(message)
            return stdout.strip()

        if cancel_check and cancel_check():
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
            raise GitCommandCanceled("run canceled by user")

        time.sleep(0.2)


def clone_repository(
    git_bin: str,
    git_url: str,
    target_path: Path,
    cancel_check: CancelCheck | None = None,
) -> None:
    if target_path.exists():
        if (target_path / ".git").exists():
            return
        raise GitCommandError(f"cache path is not a git repository: {target_path}")

    parent_dir = target_path.parent
    parent_dir.mkdir(parents=True, exist_ok=True)
    temp_path = parent_dir / f".clone-{uuid.uuid4().hex}"

    try:
        run_git_command(
            git_bin,
            ["clone", "--origin", "origin", git_url, str(temp_path)],
            cancel_check=cancel_check,
        )
        temp_path.rename(target_path)
    except Exception:
        if temp_path.exists():
            shutil.rmtree(temp_path, ignore_errors=True)
        raise


def fetch_repository(
    git_bin: str,
    repo_path: Path,
    cancel_check: CancelCheck | None = None,
) -> None:
    if not (repo_path / ".git").exists():
        raise GitCommandError(f"missing git metadata under {repo_path}")
    run_git_command(git_bin, ["fetch", "--prune", "origin"], cwd=repo_path, cancel_check=cancel_check)


def resolve_git_ref(
    git_bin: str,
    repo_path: Path,
    ref: str,
    cancel_check: CancelCheck | None = None,
) -> str:
    return run_git_command(git_bin, ["rev-parse", ref], cwd=repo_path, cancel_check=cancel_check)


def list_remote_branches(
    git_bin: str,
    repo_path: Path,
    cancel_check: CancelCheck | None = None,
) -> list[str]:
    output = run_git_command(
        git_bin,
        ["for-each-ref", "--format=%(refname:strip=3)", "refs/remotes/origin"],
        cwd=repo_path,
        cancel_check=cancel_check,
    )
    branches = []
    for line in output.splitlines():
        branch_name = line.strip()
        if not branch_name or branch_name == "HEAD":
            continue
        branches.append(branch_name)
    return sorted(set(branches))


def resolve_remote_head_branch(
    git_bin: str,
    repo_path: Path,
    cancel_check: CancelCheck | None = None,
) -> str | None:
    try:
        ref = run_git_command(
            git_bin,
            ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
            cwd=repo_path,
            cancel_check=cancel_check,
        )
    except GitCommandError:
        return None

    prefix = "refs/remotes/origin/"
    if ref.startswith(prefix):
        return ref[len(prefix):]
    return None


def directory_size_bytes(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for file_path in path.rglob("*"):
        if file_path.is_file():
            total += file_path.stat().st_size
    return total
