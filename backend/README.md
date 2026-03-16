# Backend

This directory contains the service backend for Git repository ingestion,
analysis job execution, and persisted results.

## Run

Use the requested virtualenv before running any Python command:

```bash
source /root/Xpod_Web/xpod/bin/activate
uvicorn app.main:app --app-dir backend --reload
```

The backend stores runtime data in `storage/` at the repository root:

- `storage/app.db`
- `storage/repos/`
- `storage/results/`

## Current scope

- Project and branch management
- Background analysis jobs
- Local Git cache management
- JSON result persistence
