package service

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

func (s *SyncService) TestCloudConnection(endpoint, username, password string) error {
	operationContext, finish, err := s.beginCancelableSyncOperation(context.Background())
	if err != nil {
		return err
	}
	defer finish()
	request, err := cloudRequest(operationContext, http.MethodGet, endpoint, username, password, nil)
	if err != nil {
		return err
	}
	response, err := s.performCloudRequest(request)
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
	operationContext, finish, err := s.beginCancelableSyncOperation(context.Background())
	if err != nil {
		return err
	}
	defer finish()
	outcome := "failed"
	defer func() {
		recordAudit(s.db, s.logger, model.AuditEvent{Action: "cloud_upload", TargetType: "backup", Summary: "上传云端配置", Outcome: outcome})
	}()
	credentials := cloudCredentials{endpoint: endpoint, username: username, password: password}
	err = withCryptoOperation(s.crypto, func() error {
		if uploadErr := s.uploadCloudSnapshot(operationContext, credentials); uploadErr != nil {
			return uploadErr
		}
		outcome = "success"
		return nil
	})
	if err != nil {
		return err
	}
	return nil
}

type cloudCredentials struct {
	endpoint string
	username string
	password string
}

func (s *SyncService) uploadCloudSnapshot(ctx context.Context, credentials cloudCredentials) error {
	content, err := s.encryptedCloudSnapshot()
	if err != nil {
		return err
	}
	response, err := s.putCloudBackup(ctx, credentials, content)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if err := validateCloudUploadResponse(response); err != nil {
		return err
	}
	return s.saveCloudMetadata(response.Header.Get("ETag"), "upload")
}

func (s *SyncService) encryptedCloudSnapshot() ([]byte, error) {
	masterKey, err := s.masterKey()
	if err != nil {
		return nil, err
	}
	data, err := s.snapshot()
	if err != nil {
		return nil, err
	}
	return encodeEncryptedSnapshot(data, masterKey)
}

func (s *SyncService) putCloudBackup(ctx context.Context, credentials cloudCredentials, content []byte) (*http.Response, error) {
	request, err := cloudRequest(
		ctx,
		http.MethodPut,
		credentials.endpoint,
		credentials.username,
		credentials.password,
		bytes.NewReader(content),
	)
	if err != nil {
		return nil, err
	}
	etag, err := s.cloudETag()
	if err != nil {
		return nil, err
	}
	prepareCloudUploadRequest(request, etag)
	response, err := s.performCloudRequest(request)
	if err != nil {
		return nil, fmt.Errorf("cloud upload: %w", err)
	}
	return response, nil
}

func prepareCloudUploadRequest(request *http.Request, etag string) {
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	if etag == "" {
		request.Header.Set("If-None-Match", "*")
		return
	}
	request.Header.Set("If-Match", etag)
}

func validateCloudUploadResponse(response *http.Response) error {
	if response.StatusCode == http.StatusPreconditionFailed {
		return errors.New("cloud sync conflict: remote configuration changed")
	}
	if !isCompletedSyncUploadStatus(response.StatusCode) {
		return fmt.Errorf("cloud upload returned %s", response.Status)
	}
	return nil
}

func (s *SyncService) SyncFromCloud(endpoint, username, password string) error {
	operationContext, finish, err := s.beginCancelableSyncOperation(context.Background())
	if err != nil {
		return err
	}
	defer finish()
	outcome := "failed"
	defer func() {
		recordAudit(s.db, s.logger, model.AuditEvent{Action: "cloud_download", TargetType: "backup", Summary: "下载云端配置", Outcome: outcome})
	}()
	credentials := cloudCredentials{endpoint: endpoint, username: username, password: password}
	content, etag, err := s.downloadCloudBackup(operationContext, credentials)
	if err != nil {
		return err
	}
	if err := s.restoreCloudSnapshot(content); err != nil {
		return err
	}
	if err := s.saveCloudMetadata(etag, "download"); err != nil {
		return err
	}
	outcome = "success"
	return nil
}

func (s *SyncService) downloadCloudBackup(ctx context.Context, credentials cloudCredentials) ([]byte, string, error) {
	request, err := cloudRequest(ctx, http.MethodGet, credentials.endpoint, credentials.username, credentials.password, nil)
	if err != nil {
		return nil, "", err
	}
	response, err := s.performCloudRequest(request)
	if err != nil {
		return nil, "", fmt.Errorf("cloud download: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, "", fmt.Errorf("cloud download returned %s", response.Status)
	}
	content, err := readCloudBackup(response.Body)
	if err != nil {
		return nil, "", err
	}
	return content, response.Header.Get("ETag"), nil
}

func (s *SyncService) restoreCloudSnapshot(content []byte) error {
	return withCryptoOperation(s.crypto, func() error {
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
		if s.lifecycle != nil {
			if err := s.lifecycle.PrepareDestructiveSync(); err != nil {
				return err
			}
		}
		if err := s.writeRecoveryPoint(masterKey); err != nil {
			return err
		}
		if restoreErr := s.restore(data); restoreErr != nil {
			return restoreErr
		}
		return s.applyRestoredProxySettingsWithinCryptoOperation()
	})
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
	artifact, err := decodeSyncArtifact(content, masterKey)
	return artifact.Data, err
}

func cloudRequest(ctx context.Context, method, endpoint, username, password string, body io.Reader) (*http.Request, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(endpoint))
	if err != nil {
		return nil, errors.New("cloud sync URL is invalid")
	}
	if err := requireHTTPSUnlessLoopback(parsed); err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, method, parsed.String(), body)
	if err != nil {
		return nil, err
	}
	if username != "" {
		request.SetBasicAuth(username, password)
	}
	return request, nil
}

func (s *SyncService) cloudHTTPClient() *http.Client {
	return sharedHTTPClient(20*time.Second, s.proxyManager)
}

func (s *SyncService) performCloudRequest(request *http.Request) (*http.Response, error) {
	client := sameOriginHTTPClient(s.cloudHTTPClient(), request.URL)
	return client.Do(request)
}

func (s *SyncService) cloudETag() (string, error) {
	var raw string
	err := s.db.QueryRow("SELECT value FROM settings WHERE key = ?", syncETagSetting).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read cloud ETag: %w", err)
	}
	var value string
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return "", fmt.Errorf("decode cloud ETag: %w", err)
	}
	return value, nil
}

func (s *SyncService) saveCloudMetadata(etag, direction string) error {
	values := map[string]any{syncETagSetting: etag, syncLastAtSetting: time.Now().UTC().Format(time.RFC3339), syncDirectionSetting: direction}
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
