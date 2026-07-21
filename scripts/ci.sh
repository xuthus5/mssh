#!/usr/bin/env bash
# Local/CI quality gate. Prefer: wails3 task ci
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if command -v wails3 >/dev/null 2>&1; then
  exec wails3 task ci
fi

echo "wails3 not found; running gate steps directly" >&2

if ! command -v golangci-lint >/dev/null 2>&1; then
  echo "install golangci-lint v2.12.2 first:" >&2
  echo "  go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2" >&2
  exit 1
fi

golangci-lint version
golangci-lint run --timeout 5m ./...

go test -race -coverprofile=coverage.out -covermode=atomic \
  -coverpkg=./internal/...,./pkg/... ./internal/... ./pkg/...
go tool cover -func=coverage.out | tee coverage.func.txt
go tool cover -func=coverage.out | grep total | awk '{if ($3+0 < 90) { print "coverage below 90%:", $3; exit 1 }}'

(
  cd frontend
  npm run check:source-limits
node scripts/check-go-source-limits.mjs
  npm run check:bundle-budget
  npm test
)

CGO_ENABLED=1 wails3 build
