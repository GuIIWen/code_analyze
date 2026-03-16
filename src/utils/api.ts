import { DashboardStats } from './dataProcessor';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

interface ApiSuccess<T> {
  success: true;
  data: T;
}

interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface ProjectSummary {
  id: number;
  name: string;
  git_url: string;
  default_branch: string;
  local_repo_path: string;
  status: string;
  branch_count: number;
  last_fetched_at?: string | null;
  last_analyzed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BranchSummary {
  id: number;
  project_id: number;
  branch_name: string;
  is_default: boolean;
  analyzer_config: Record<string, unknown>;
  last_commit_sha?: string | null;
  last_run_id?: number | null;
  last_result_path?: string | null;
  last_analyzed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunSummary {
  id: number;
  project_id: number;
  branch_id: number;
  trigger_type: string;
  status: string;
  requested_ref?: string | null;
  commit_sha?: string | null;
  result_json_path?: string | null;
  result_csv_path?: string | null;
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectDetail {
  project: ProjectSummary;
  branches: BranchSummary[];
  recent_runs: RunSummary[];
}

export interface ProjectCreatePayload {
  name?: string;
  git_url: string;
  default_branch: string;
}

export interface ProjectCreateResult extends ProjectSummary {
  default_branch_record: BranchSummary;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    },
    ...init
  });

  const payload = await response.json() as ApiResponse<T>;
  if (!response.ok || !payload.success) {
    const message = payload.success ? `HTTP ${response.status}` : payload.error.message;
    throw new Error(message);
  }
  return payload.data;
}

export const healthCheck = () => request<{ status: string }>('/health');
export const listProjects = () => request<ProjectSummary[]>('/projects');
export const getProjectDetail = (projectId: number) => request<ProjectDetail>(`/projects/${projectId}`);
export const createProject = (payload: ProjectCreatePayload) => request<ProjectCreateResult>('/projects', {
  method: 'POST',
  body: JSON.stringify(payload)
});
export const deleteProject = (projectId: number) => request<{ deleted: boolean }>(`/projects/${projectId}?mode=full`, {
  method: 'DELETE'
});
export const listBranches = (projectId: number) => request<BranchSummary[]>(`/projects/${projectId}/branches`);
export const createBranch = (
  projectId: number,
  payload: { branch_name: string; is_default?: boolean; analyzer_config?: Record<string, unknown> }
) => request<BranchSummary>(`/projects/${projectId}/branches`, {
  method: 'POST',
  body: JSON.stringify(payload)
});
export const updateBranch = (
  projectId: number,
  branchId: number,
  payload: { is_default?: boolean; analyzer_config?: Record<string, unknown> }
) => request<BranchSummary>(`/projects/${projectId}/branches/${branchId}`, {
  method: 'PATCH',
  body: JSON.stringify(payload)
});
export const triggerBranchUpdate = (
  projectId: number,
  branchId: number,
  force = false
) => request<{ run_id: number; status: string }>(`/projects/${projectId}/branches/${branchId}/update`, {
  method: 'POST',
  body: JSON.stringify({ force })
});
export const triggerBranchReanalyze = (
  projectId: number,
  branchId: number,
  commitSha?: string
) => request<{ run_id: number; status: string }>(`/projects/${projectId}/branches/${branchId}/reanalyze`, {
  method: 'POST',
  body: JSON.stringify({ commit_sha: commitSha || null })
});
export const getRun = (runId: number) => request<RunSummary>(`/runs/${runId}`);
export const getRunResult = (runId: number) => request<DashboardStats>(`/runs/${runId}/result`);
export const getLatestBranchResult = (projectId: number, branchId: number) =>
  request<DashboardStats>(`/projects/${projectId}/branches/${branchId}/result/latest`);
export const getProjectCache = (projectId: number) => request<{
  local_repo_path: string;
  exists: boolean;
  size_bytes: number;
  last_fetched_at?: string | null;
}>(`/projects/${projectId}/cache`);
export const clearProjectCache = (projectId: number) => request<{ cleared: boolean }>(`/projects/${projectId}/cache/clear`, {
  method: 'POST'
});
