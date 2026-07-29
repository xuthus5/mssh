package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/xuthus5/mssh/internal/fsutil"
)

const (
	transferFinalizationJournalMaxBytes     = 1 << 20
	transferFinalizationJournalMaxEntries   = 4096
	transferFinalizationJournalMaxTaskID    = 256
	transferFinalizationJournalMaxErrorText = 4096
	transferFinalizationJournalDirectory    = "transfer-finalizations"
	transferFinalizationJournalFile         = "journal.json"
)

type transferFinalizationJournalStore struct {
	directory  string
	path       string
	blockedErr error
}

type transferFinalizationJournalDocument struct {
	Entries []transferFinalizationJournalEntry `json:"entries"`
}

type transferFinalizationJournalEntry struct {
	TaskID       string `json:"task_id"`
	Status       string `json:"status"`
	ErrorMessage string `json:"error_message,omitempty"`
	Transferred  int64  `json:"transferred"`
	Total        int64  `json:"total"`
	CompletedAt  string `json:"completed_at"`
}

func newTransferFinalizationJournalStore(dataDir string) *transferFinalizationJournalStore {
	if strings.TrimSpace(dataDir) == "" {
		return nil
	}
	directory := filepath.Join(dataDir, transferFinalizationJournalDirectory)
	return &transferFinalizationJournalStore{
		directory: directory,
		path:      filepath.Join(directory, transferFinalizationJournalFile),
	}
}

func (f *FileService) loadTransferFinalizationJournal() {
	if f == nil || f.finalizationJournal == nil {
		return
	}
	finalizations, err := f.finalizationJournal.load()
	if err != nil {
		if f.logger != nil {
			f.logger.Error("load transfer finalization journal failed", "error", err)
		}
		return
	}
	for _, finalization := range finalizations {
		f.pendingFinalizations[finalization.taskID] = finalization
	}
}

func (f *FileService) persistTransferFinalizationJournalLocked() error {
	if f.finalizationJournal == nil {
		return nil
	}
	finalizations := make([]transferFinalization, 0, len(f.pendingFinalizations))
	for _, finalization := range f.pendingFinalizations {
		finalizations = append(finalizations, finalization)
	}
	return f.finalizationJournal.persist(finalizations)
}

func (journal *transferFinalizationJournalStore) load() ([]transferFinalization, error) {
	if err := journal.ensureDirectory(); err != nil {
		journal.blockedErr = err
		return nil, err
	}
	data, mode, err := journal.readFile()
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		journal.blockedErr = err
		return nil, err
	}
	finalizations, err := decodeTransferFinalizationJournal(data)
	if err != nil {
		journal.blockedErr = err
		return nil, err
	}
	if privateFileModeNeedsRepair(mode) {
		if err := journal.replace(data); err != nil {
			journal.blockedErr = err
			return nil, err
		}
	}
	return finalizations, nil
}

func (journal *transferFinalizationJournalStore) ensureDirectory() error {
	if err := os.MkdirAll(journal.directory, 0o700); err != nil {
		return fmt.Errorf("create journal directory: %w", err)
	}
	info, err := os.Lstat(journal.directory)
	if err != nil {
		return fmt.Errorf("inspect journal directory: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("journal directory is not a regular directory")
	}
	if err := os.Chmod(journal.directory, 0o700); err != nil {
		return fmt.Errorf("secure journal directory: %w", err)
	}
	return nil
}

func (journal *transferFinalizationJournalStore) readFile() ([]byte, os.FileMode, error) {
	file, info, err := fsutil.OpenRegularFile(journal.path)
	if err != nil {
		return nil, 0, err
	}
	if info.Size() > transferFinalizationJournalMaxBytes {
		closeErr := file.Close()
		return nil, 0, errors.Join(fmt.Errorf("journal exceeds %d bytes", transferFinalizationJournalMaxBytes), closeErr)
	}
	data, readErr := io.ReadAll(io.LimitReader(file, transferFinalizationJournalMaxBytes+1))
	closeErr := file.Close()
	if err := errors.Join(readErr, closeErr); err != nil {
		return nil, 0, fmt.Errorf("read journal: %w", err)
	}
	if len(data) > transferFinalizationJournalMaxBytes {
		return nil, 0, fmt.Errorf("journal exceeds %d bytes", transferFinalizationJournalMaxBytes)
	}
	return data, info.Mode(), nil
}

func decodeTransferFinalizationJournal(data []byte) ([]transferFinalization, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var document transferFinalizationJournalDocument
	if err := decoder.Decode(&document); err != nil {
		return nil, fmt.Errorf("decode journal: %w", err)
	}
	if err := requireJournalEOF(decoder); err != nil {
		return nil, err
	}
	if document.Entries == nil || len(document.Entries) > transferFinalizationJournalMaxEntries {
		return nil, fmt.Errorf("invalid journal entry count %d", len(document.Entries))
	}
	return validateTransferFinalizationJournalEntries(document.Entries)
}

func requireJournalEOF(decoder *json.Decoder) error {
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return fmt.Errorf("journal contains trailing data")
		}
		return fmt.Errorf("decode journal trailing data: %w", err)
	}
	return nil
}

func validateTransferFinalizationJournalEntries(entries []transferFinalizationJournalEntry) ([]transferFinalization, error) {
	result := make([]transferFinalization, 0, len(entries))
	seen := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		finalization, err := entry.finalization()
		if err != nil {
			return nil, err
		}
		if _, exists := seen[finalization.taskID]; exists {
			return nil, fmt.Errorf("duplicate journal task id %q", finalization.taskID)
		}
		seen[finalization.taskID] = struct{}{}
		result = append(result, finalization)
	}
	return result, nil
}

func (entry transferFinalizationJournalEntry) finalization() (transferFinalization, error) {
	if strings.TrimSpace(entry.TaskID) != entry.TaskID || entry.TaskID == "" || len(entry.TaskID) > transferFinalizationJournalMaxTaskID {
		return transferFinalization{}, fmt.Errorf("invalid journal task id")
	}
	if strings.ContainsRune(entry.TaskID, '\x00') || transferFinalizationPriority(entry.Status) == transferFinalizationUnknownPriority {
		return transferFinalization{}, fmt.Errorf("invalid journal task or status")
	}
	if len(entry.ErrorMessage) > transferFinalizationJournalMaxErrorText ||
		strings.ContainsRune(entry.ErrorMessage, '\x00') || !utf8.ValidString(entry.ErrorMessage) {
		return transferFinalization{}, fmt.Errorf("invalid journal error message")
	}
	if entry.Transferred < 0 || entry.Total < 0 || entry.Transferred > entry.Total {
		return transferFinalization{}, fmt.Errorf("invalid journal progress")
	}
	if entry.Status != "completed" && (entry.Transferred != 0 || entry.Total != 0) {
		return transferFinalization{}, fmt.Errorf("non-completed journal entry contains progress")
	}
	if entry.Status == "completed" && entry.ErrorMessage != "" {
		return transferFinalization{}, fmt.Errorf("completed journal entry contains an error")
	}
	completedAt, err := time.Parse(time.RFC3339Nano, entry.CompletedAt)
	if err != nil || completedAt.IsZero() {
		return transferFinalization{}, fmt.Errorf("invalid journal completion time")
	}
	return transferFinalization{
		taskID: entry.TaskID, status: entry.Status, errorMessage: entry.ErrorMessage,
		transferred: entry.Transferred, total: entry.Total, completedAt: completedAt.UTC(),
	}, nil
}

func (journal *transferFinalizationJournalStore) persist(finalizations []transferFinalization) error {
	if journal.blockedErr != nil {
		return fmt.Errorf("journal disabled after load failure: %w", journal.blockedErr)
	}
	if err := journal.ensureDirectory(); err != nil {
		return err
	}
	data, err := encodeTransferFinalizationJournal(finalizations)
	if err != nil {
		return err
	}
	return journal.replace(data)
}
