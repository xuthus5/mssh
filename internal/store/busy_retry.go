package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

const (
	busyRetryAttempts = 8
	busyRetryBase     = 5 * time.Millisecond
)

// withBusyRetry retries transient SQLite busy/locked errors so progress/audit
// writes can coexist with longer import/sync transactions on a single connection.
func withBusyRetry(op func() error) error {
	var err error
	delay := busyRetryBase
	for attempt := 0; attempt < busyRetryAttempts; attempt++ {
		err = op()
		if err == nil || !isSQLiteBusy(err) {
			return err
		}
		time.Sleep(delay)
		if delay < 80*time.Millisecond {
			delay *= 2
		}
	}
	return err
}

func isSQLiteBusy(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, sql.ErrTxDone) {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "database is locked") ||
		strings.Contains(msg, "sqlite_busy") ||
		strings.Contains(msg, "locked")
}
