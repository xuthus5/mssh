# Performance Budgets

The following local budgets are enforced by tests on the reference development environment:

- List 1,000 persisted sessions in under 250 ms.
- Persist 1,000 transfer progress updates in under 2 s.
- Dispatch 10,000 terminal output chunks of 1 KiB in under 500 ms.
- Parse 10,000 system-monitor samples in under 500 ms.

Run enforcement tests with `go test ./internal/store ./internal/service`. Run allocation-aware measurements with `task benchmark`.

The E2E SSH gate starts an isolated local `sshd` and requires `sshd`, `ssh-keygen`, and `tmux`. Run it with `task test:e2e`.
