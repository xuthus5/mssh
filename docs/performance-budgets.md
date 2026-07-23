# Performance Budgets

The following local budgets are enforced by tests on the reference development environment
(and CI runners with race detector slack where noted):

| Path | Workload | Budget | Enforced by |
|---|---|---|---|
| Session list | List 1,000 persisted sessions | **750 ms** (CI/race slack; target ~250 ms on quiet desktop) | `internal/store/performance_test.go` |
| Transfer progress | Persist 1,000 progress updates | **3 s** (CI/race slack; target ~2 s) | `internal/store/performance_test.go` |
| Terminal output | Dispatch 10,000 × 1 KiB chunks | **500 ms** | `internal/service/performance_test.go` |
| System monitor parse | Parse 10,000 samples | **500 ms** | `internal/service/performance_test.go` |

Tight absolute targets (250 ms list / 2 s transfer) are design goals for local profiling via
`task benchmark` and must not be used as hard CI gates under `-race` on shared runners.

Run enforcement tests with:

```bash
go test ./internal/store ./internal/service -run 'PerformanceBudgets|RuntimePerformance'
```

Run allocation-aware measurements with `task benchmark`.

The E2E SSH gate starts an isolated local `sshd` and requires `sshd`, `ssh-keygen`, and `tmux`.
Run it with `task test:e2e`.
