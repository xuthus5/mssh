package service

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"sync/atomic"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/netproxy"
)

const (
	SyncMasterKeySetting = "sync.master_key"
	syncFormatVersion    = 3
	syncRecoveryFileName = "pre-import.msshbackup"
	syncETagSetting      = "sync.etag"
	syncLastAtSetting    = "sync.last_at"
	syncDirectionSetting = "sync.last_direction"
	syncVersionSetting   = "sync.format_version"
	maxCloudBackupSize   = 32 * 1024 * 1024
)

var errSyncOperationRunning = errors.New("sync operation is already running")

var backupTables = []string{"session_folders", "ssh_keys", "asset_environments", "asset_projects", "asset_tags", "sessions", "session_tags", "tunnels", "macros", "serial_ports", "settings", "themes", "terminal_theme_profiles", "transfer_jobs"}

var backupDeleteOrder = []string{"transfer_jobs", "terminal_theme_profiles", "themes", "tunnels", "session_tags", "sessions", "asset_tags", "asset_projects", "asset_environments", "ssh_keys", "session_folders", "macros", "serial_ports", "settings"}

type SyncService struct {
	db                        *sql.DB
	logger                    *slog.Logger
	dataDir                   string
	crypto                    KeyCrypto
	secretSource              func() (string, error)
	vaultSource               func() (*backupcrypto.VaultFile, error)
	vaultTransactionInstaller func(password string, vault backupcrypto.VaultFile) (VaultInstallTransaction, error)
	eventBus                  EventBus
	lifecycle                 syncLifecycle
	providerFactory           syncProviderFactory
	operationMu               sync.Mutex
	shutdownMu                sync.Mutex
	readOperations            sync.WaitGroup
	stopped                   bool
	activeCancel              context.CancelFunc
	configMu                  sync.Mutex
	stateMu                   sync.RWMutex
	state                     syncRuntimeState
	schedulerMu               sync.Mutex
	schedulerCancel           context.CancelFunc
	schedulerContext          context.Context
	schedulerStop             context.CancelFunc
	schedulerWG               sync.WaitGroup
	schedulerStopped          bool
	unlockCatchUpRunning      atomic.Bool
	proxyManager              *netproxy.Manager
	runtimeSettings           SyncRuntimeSettings
}

type SyncOption func(*SyncService)

func NewSyncService(db *sql.DB, logger *slog.Logger, options ...SyncOption) *SyncService {
	schedulerContext, schedulerStop := context.WithCancel(context.Background())
	service := &SyncService{
		db: db, logger: logger, providerFactory: defaultSyncProviderFactory{},
		schedulerContext: schedulerContext, schedulerStop: schedulerStop,
	}
	for _, option := range options {
		option(service)
	}
	if service.proxyManager != nil {
		service.providerFactory = proxyAwareSyncProviderFactory{service: service}
	}
	return service
}

type ExportData struct {
	FormatVersion int                         `json:"format_version"`
	Tables        map[string][]map[string]any `json:"tables"`
}

func (s *SyncService) Export(path string) error {
	cleaned, err := validateLocalFilePath(path)
	if err != nil {
		return fmt.Errorf("export: %w", err)
	}
	path = cleaned
	if err := s.beginSyncOperation(); err != nil {
		return fmt.Errorf("export: %w", err)
	}
	defer s.operationMu.Unlock()
	outcome := "failed"
	defer func() {
		recordAudit(s.db, s.logger, model.AuditEvent{Action: "export", TargetType: "backup", Summary: "导出加密配置", Outcome: outcome})
	}()
	if err := withCryptoOperation(s.crypto, func() error { return s.exportSnapshot(path) }); err != nil {
		return fmt.Errorf("export: %w", err)
	}
	outcome = "success"
	return nil
}

func (s *SyncService) Import(path string) error {
	cleaned, err := validateLocalFilePath(path)
	if err != nil {
		return fmt.Errorf("import: %w", err)
	}
	path = cleaned
	if err := s.beginSyncOperation(); err != nil {
		return fmt.Errorf("import: %w", err)
	}
	defer s.operationMu.Unlock()
	outcome := "failed"
	defer func() {
		recordAudit(s.db, s.logger, model.AuditEvent{Action: "import", TargetType: "backup", Summary: "导入加密配置", Outcome: outcome})
	}()
	if err := withCryptoOperation(s.crypto, func() error { return s.importSnapshot(path) }); err != nil {
		return fmt.Errorf("import: %w", err)
	}
	outcome = "success"
	return nil
}

func (s *SyncService) snapshot() (ExportData, error) {
	tx, err := s.db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return ExportData{}, fmt.Errorf("begin snapshot: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	data, err := snapshotFromTables(tx)
	if err != nil {
		return ExportData{}, err
	}
	if err := tx.Commit(); err != nil {
		return ExportData{}, fmt.Errorf("commit snapshot: %w", err)
	}
	return data, nil
}

type tableQuerier interface {
	Query(query string, args ...any) (*sql.Rows, error)
}

func snapshotFromTables(querier tableQuerier) (ExportData, error) {
	tables := make(map[string][]map[string]any, len(backupTables))
	for _, table := range backupTables {
		if isLocalRuntimeTable(table) {
			tables[table] = []map[string]any{}
			continue
		}
		rows, err := readTable(querier, table)
		if err != nil {
			return ExportData{}, fmt.Errorf("read %s: %w", table, err)
		}
		if table == "settings" {
			filtered := rows[:0]
			for _, row := range rows {
				key, _ := row["key"].(string)
				if !strings.HasPrefix(key, "sync.") && !isLocalOnlySetting(key) {
					filtered = append(filtered, row)
				}
			}
			rows = filtered
		}
		tables[table] = rows
	}
	return ExportData{FormatVersion: syncFormatVersion, Tables: tables}, nil
}

func decodeSnapshot(content []byte, data *ExportData) error {
	*data = ExportData{}
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(data); err != nil {
		return fmt.Errorf("decode snapshot: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("decode snapshot: trailing JSON value")
	}
	if data.FormatVersion != syncFormatVersion {
		return fmt.Errorf("snapshot format_version must be %d, got %d", syncFormatVersion, data.FormatVersion)
	}
	for _, table := range backupTables {
		if _, ok := data.Tables[table]; !ok {
			return fmt.Errorf("snapshot table %s is required", table)
		}
	}
	if err := normalizeSnapshotNumbers(data); err != nil {
		return err
	}
	return nil
}

func (s *SyncService) restore(data ExportData) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin restore: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := restoreIntoTransaction(tx, data); err != nil {
		return err
	}
	return tx.Commit()
}

func restoreIntoTransaction(tx *sql.Tx, data ExportData) error {
	for _, table := range backupDeleteOrder {
		if isLocalRuntimeTable(table) {
			continue
		}
		statement := "DELETE FROM " + table
		arguments := []any(nil)
		if table == "settings" {
			statement = "DELETE FROM settings WHERE key NOT LIKE 'sync.%' AND key <> ?"
			arguments = []any{securityRotationPendingSetting}
		}
		if _, err := tx.Exec(statement, arguments...); err != nil {
			return fmt.Errorf("clear %s: %w", table, err)
		}
	}
	for _, table := range backupTables {
		if isLocalRuntimeTable(table) {
			continue
		}
		for _, row := range data.Tables[table] {
			if err := insertRow(tx, table, row); err != nil {
				return fmt.Errorf("restore %s: %w", table, err)
			}
		}
	}
	return nil
}

func isLocalRuntimeTable(table string) bool {
	return table == "transfer_jobs"
}

func readTable(querier tableQuerier, table string) ([]map[string]any, error) {
	rows, err := querier.Query("SELECT * FROM " + table)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0)
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		row := make(map[string]any, len(columns))
		for i, value := range values {
			if bytes, ok := value.([]byte); ok {
				row[columns[i]] = string(bytes)
			} else {
				row[columns[i]] = value
			}
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func insertRow(tx *sql.Tx, table string, row map[string]any) error {
	columns := make([]string, 0, len(row))
	for column := range row {
		columns = append(columns, column)
	}
	sort.Strings(columns)
	values := make([]any, len(columns))
	for index, column := range columns {
		values[index] = row[column]
	}
	placeholders := make([]string, len(columns))
	for i := range placeholders {
		placeholders[i] = "?"
	}
	_, err := tx.Exec("INSERT INTO "+table+" ("+strings.Join(columns, ",")+") VALUES ("+strings.Join(placeholders, ",")+")", values...)
	return err
}
