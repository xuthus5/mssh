package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
)

func (s *SyncService) TestCloudConnection(endpoint, username, password string) error {
	request, err := cloudRequest(http.MethodGet, endpoint, username, password, nil)
	if err != nil {
		return err
	}
	response, err := cloudHTTPClient().Do(request)
	if err != nil {
		return fmt.Errorf("cloud connection: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("cloud connection returned %s", response.Status)
	}
	return nil
}

func (s *SyncService) SyncToCloud(endpoint, username, password string) error {
	outcome := "failed"
	defer func() {
		recordAudit(s.db, s.logger, model.AuditEvent{Action: "cloud_upload", TargetType: "backup", Summary: "上传云端配置", Outcome: outcome})
	}()
	masterKey, err := s.masterKey()
	if err != nil {
		return err
	}
	data, err := s.snapshot()
	if err != nil {
		return err
	}
	content, err := encodeEncryptedSnapshot(data, masterKey)
	if err != nil {
		return err
	}
	request, err := cloudRequest(http.MethodPut, endpoint, username, password, bytes.NewReader(content))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	if etag := s.cloudETag(); etag != "" {
		request.Header.Set("If-Match", etag)
	} else {
		request.Header.Set("If-None-Match", "*")
	}
	response, err := cloudHTTPClient().Do(request)
	if err != nil {
		return fmt.Errorf("cloud upload: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode == http.StatusPreconditionFailed {
		return errors.New("cloud sync conflict: remote configuration changed")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("cloud upload returned %s", response.Status)
	}
	if err := s.saveCloudMetadata(response.Header.Get("ETag"), "upload"); err != nil {
		return err
	}
	outcome = "success"
	return nil
}

func (s *SyncService) SyncFromCloud(endpoint, username, password string) error {
	outcome := "failed"
	defer func() {
		recordAudit(s.db, s.logger, model.AuditEvent{Action: "cloud_download", TargetType: "backup", Summary: "下载云端配置", Outcome: outcome})
	}()
	request, err := cloudRequest(http.MethodGet, endpoint, username, password, nil)
	if err != nil {
		return err
	}
	response, err := cloudHTTPClient().Do(request)
	if err != nil {
		return fmt.Errorf("cloud download: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("cloud download returned %s", response.Status)
	}
	content, err := readCloudBackup(response.Body)
	if err != nil {
		return err
	}
	masterKey, err := s.masterKey()
	if err != nil {
		return err
	}
	data, err := decodeEncryptedSnapshot(content, masterKey)
	if err != nil {
		return err
	}
	if err := validateSnapshot(s.db, data); err != nil {
		return err
	}
	if err := s.writeRecoveryPoint(masterKey); err != nil {
		return err
	}
	if err := s.restore(data); err != nil {
		return err
	}
	if err := s.saveCloudMetadata(response.Header.Get("ETag"), "download"); err != nil {
		return err
	}
	outcome = "success"
	return nil
}

func readCloudBackup(reader io.Reader) ([]byte, error) {
	content, err := io.ReadAll(io.LimitReader(reader, maxCloudBackupSize+1))
	if err != nil {
		return nil, fmt.Errorf("read cloud backup: %w", err)
	}
	if len(content) > maxCloudBackupSize {
		return nil, fmt.Errorf("cloud backup exceeds %d bytes", maxCloudBackupSize)
	}
	return content, nil
}

func decodeEncryptedSnapshot(content []byte, masterKey string) (ExportData, error) {
	var envelope backupcrypto.BackupEnvelope
	if err := json.Unmarshal(content, &envelope); err != nil {
		return ExportData{}, err
	}
	plaintext, err := backupcrypto.DecryptBackup(envelope, []byte(masterKey))
	if err != nil {
		return ExportData{}, err
	}
	var data ExportData
	if err := decodeSnapshot(plaintext, &data); err != nil {
		return ExportData{}, err
	}
	return data, nil
}

func cloudRequest(method, endpoint, username, password string, body io.Reader) (*http.Request, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(endpoint))
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return nil, errors.New("cloud sync URL must use http or https")
	}
	request, err := http.NewRequest(method, parsed.String(), body)
	if err != nil {
		return nil, err
	}
	if username != "" {
		request.SetBasicAuth(username, password)
	}
	return request, nil
}

func cloudHTTPClient() *http.Client { return &http.Client{Timeout: 20 * time.Second} }

func (s *SyncService) cloudETag() string {
	var raw string
	if err := s.db.QueryRow("SELECT value FROM settings WHERE key = ?", syncETagSetting).Scan(&raw); err != nil {
		return ""
	}
	var value string
	_ = json.Unmarshal([]byte(raw), &value)
	return value
}

func (s *SyncService) saveCloudMetadata(etag, direction string) error {
	values := map[string]any{syncETagSetting: etag, syncLastAtSetting: time.Now().UTC().Format(time.RFC3339), syncDirectionSetting: direction, syncVersionSetting: syncFormatVersion}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for key, value := range values {
		encoded, marshalErr := json.Marshal(value)
		if marshalErr != nil {
			return marshalErr
		}
		if _, execErr := tx.Exec(`INSERT INTO settings (key, namespace, value, value_type, version) VALUES (?, 'sync', ?, 'string', 1) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`, key, string(encoded)); execErr != nil {
			return execErr
		}
	}
	return tx.Commit()
}
