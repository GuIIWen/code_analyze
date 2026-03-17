from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from pathlib import Path
from typing import Any

from app.git_client import run_git_command


def analyze_git_reference(
    *,
    git_bin: str,
    repo_path: Path,
    ref: str,
    group_name: str,
    project_name: str,
    branch_name: str,
    commit_sha: str,
    run_id: int,
    max_lines: int,
    cancel_check: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    output = run_git_command(
        git_bin,
        [
            "log",
            "--numstat",
            "--pretty=format:COMMIT_SEP|%ad|%aN",
            "--date=format:%Y-%m",
            ref,
        ],
        cwd=repo_path,
        cancel_check=cancel_check,
    )

    stats: dict[tuple[str, str], dict[str, int]] = defaultdict(
        lambda: {"added": 0, "deleted": 0, "commits": 0}
    )

    lines = output.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if not line:
            index += 1
            continue

        if not line.startswith("COMMIT_SEP|"):
            index += 1
            continue

        _, month, author = line.split("|", 2)
        commit_added = 0
        commit_deleted = 0
        index += 1

        while index < len(lines) and not lines[index].startswith("COMMIT_SEP|"):
            stat_line = lines[index].strip()
            if stat_line:
                parts = stat_line.split("\t", 2)
                if len(parts) >= 2:
                    try:
                        added = int(parts[0]) if parts[0] != "-" else 0
                        deleted = int(parts[1]) if parts[1] != "-" else 0
                    except ValueError:
                        added = 0
                        deleted = 0
                    commit_added += added
                    commit_deleted += deleted
            index += 1

        if commit_added + commit_deleted <= max_lines:
            bucket = stats[(month, author)]
            bucket["added"] += commit_added
            bucket["deleted"] += commit_deleted
            bucket["commits"] += 1

    records = [
        {
            "month": month,
            "author": author,
            "project": project_name,
            "group": group_name,
            "added": values["added"],
            "deleted": values["deleted"],
            "net": values["added"] - values["deleted"],
            "commits": values["commits"],
        }
        for (month, author), values in sorted(stats.items())
    ]

    all_months = sorted({record["month"] for record in records})
    monthly_trends = [
        {
            "month": month,
            "added": sum(record["added"] for record in records if record["month"] == month),
            "deleted": sum(
                record["deleted"] for record in records if record["month"] == month
            ),
            "net": sum(record["net"] for record in records if record["month"] == month),
            "commits": sum(
                record["commits"] for record in records if record["month"] == month
            ),
        }
        for month in all_months
    ]

    author_stats: dict[str, dict[str, int]] = defaultdict(
        lambda: {"added": 0, "deleted": 0, "net": 0, "commits": 0}
    )
    for record in records:
        author_bucket = author_stats[record["author"]]
        author_bucket["added"] += record["added"]
        author_bucket["deleted"] += record["deleted"]
        author_bucket["net"] += record["net"]
        author_bucket["commits"] += record["commits"]

    author_project_stats = [
        {
            "key": f"{group_name}-{project_name}-{author}",
            "group": group_name,
            "project": project_name,
            "author": author,
            "added": values["added"],
            "deleted": values["deleted"],
            "net": values["net"],
            "commits": values["commits"],
        }
        for author, values in sorted(author_stats.items())
    ]

    project_summary = {
        "key": f"{group_name}-{project_name}",
        "group": group_name,
        "project": project_name,
        "added": sum(record["added"] for record in records),
        "deleted": sum(record["deleted"] for record in records),
        "net": sum(record["net"] for record in records),
        "commits": sum(record["commits"] for record in records),
        "authorCount": len(author_stats),
    }

    group_summary = {
        "group": group_name,
        "added": project_summary["added"],
        "deleted": project_summary["deleted"],
        "net": project_summary["net"],
        "commits": project_summary["commits"],
        "projectCount": 1,
        "authorCount": len(author_stats),
    }

    return {
        "projectMeta": {"name": group_name},
        "branchMeta": {"name": branch_name},
        "runMeta": {"id": run_id, "commitSha": commit_sha},
        "totalAdded": project_summary["added"],
        "totalDeleted": project_summary["deleted"],
        "totalNet": project_summary["net"],
        "totalCommits": project_summary["commits"],
        "authorCount": len(author_stats),
        "allMonths": all_months,
        "allGroups": [group_name],
        "monthlyTrends": monthly_trends,
        "groupMonthlyTrends": {group_name: monthly_trends},
        "groupStats": [group_summary],
        "projectStats": [project_summary],
        "authorProjectStats": author_project_stats,
        "fullData": records,
    }
