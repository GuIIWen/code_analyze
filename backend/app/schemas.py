from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str | None = None
    git_url: str
    default_branch: str = "main"


class ProjectUpdate(BaseModel):
    name: str | None = None
    default_branch: str | None = None


class BranchCreate(BaseModel):
    branch_name: str
    is_default: bool = False
    analyzer_config: dict[str, Any] = Field(default_factory=dict)


class BranchUpdate(BaseModel):
    is_default: bool | None = None
    analyzer_config: dict[str, Any] | None = None


class BranchUpdateRequest(BaseModel):
    force: bool = False


class BranchReanalyzeRequest(BaseModel):
    commit_sha: str | None = None


class CleanupRunsRequest(BaseModel):
    keep_latest: int = 5

