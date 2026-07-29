package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/xuthus5/mssh/internal/fsutil"
)

func encodeTransferFinalizationJournal(finalizations []transferFinalization) ([]byte, error) {
	entries := make([]transferFinalizationJournalEntry, 0, len(finalizations))
	for _, finalization := range finalizations {
		entry := transferFinalizationJournalEntry{
			TaskID: finalization.taskID, Status: finalization.status,
			ErrorMessage: sanitizeTransferFinalizationErrorMessage(finalization.errorMessage),
			Transferred:  finalization.transferred, Total: finalization.total,
			CompletedAt: finalization.completedAt.UTC().Format(time.RFC3339Nano),
		}
		if _, err := entry.finalization(); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(left, right int) bool { return entries[left].TaskID < entries[right].TaskID })
	document := transferFinalizationJournalDocument{Entries: entries}
	data, err := json.Marshal(document)
	if err != nil {
		return nil, fmt.Errorf("encode journal: %w", err)
	}
	if len(data) > transferFinalizationJournalMaxBytes {
		return nil, fmt.Errorf("journal exceeds %d bytes", transferFinalizationJournalMaxBytes)
	}
	return data, nil
}

func sanitizeTransferFinalizationErrorMessage(message string) string {
	sanitized := strings.ReplaceAll(message, "\x00", "\uFFFD")
	sanitized = strings.ToValidUTF8(sanitized, "\uFFFD")
	if len(sanitized) <= transferFinalizationJournalMaxErrorText {
		return sanitized
	}
	boundary := transferFinalizationJournalMaxErrorText
	for boundary > 0 && !utf8.RuneStart(sanitized[boundary]) {
		boundary--
	}
	return sanitized[:boundary]
}

func (journal *transferFinalizationJournalStore) replace(data []byte) error {
	if err := journal.validateTarget(); err != nil {
		return err
	}
	if err := fsutil.WritePrivateFileAtomic(journal.path, data, ".journal-*.tmp"); err != nil {
		return fmt.Errorf("write journal: %w", err)
	}
	return nil
}

func (journal *transferFinalizationJournalStore) validateTarget() error {
	info, err := os.Lstat(journal.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect journal target: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("journal target is not a regular file")
	}
	return nil
}
