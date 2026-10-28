package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const (
	syncGistRefreshTokenSetting   = "sync.secret.gist_refresh_token"
	syncGistTokenExpiresAtSetting = "sync.gist_token_expires_at"
)

func WithSyncGistOAuthClientID(clientID string) SyncOption {
	return func(service *SyncService) { service.gistOAuthClientID = strings.TrimSpace(clientID) }
}

func gistOAuthSecretDeletes(input model.GistSyncConfigInput) []string {
	if input.Token == "" && !input.ClearToken {
		return nil
	}
	return []string{syncGistRefreshTokenSetting, syncGistTokenExpiresAtSetting}
}

func (s *SyncService) storeGistOAuthCredentials(response gistTokenResponse) error {
	if err := s.beginSyncOperation(); err != nil {
		return err
	}
	defer s.operationMu.Unlock()
	return s.storeGistOAuthCredentialsLocked(response)
}

func (s *SyncService) storeGistOAuthCredentialsLocked(response gistTokenResponse) error {
	return withCryptoOperation(s.crypto, func() error {
		return s.storeGistOAuthCredentialsUnlocked(response)
	})
}

func (s *SyncService) storeGistOAuthCredentialsUnlocked(response gistTokenResponse) error {
	settings := make([]model.Setting, 0, 3)
	access, err := s.encryptedSecretSetting(syncGistTokenSetting, response.AccessToken)
	if err != nil {
		return err
	}
	settings = append(settings, access)
	deletes := make([]string, 0, 2)
	if strings.TrimSpace(response.RefreshToken) != "" {
		refresh, err := s.encryptedSecretSetting(syncGistRefreshTokenSetting, response.RefreshToken)
		if err != nil {
			return err
		}
		settings = append(settings, refresh)
	} else {
		deletes = append(deletes, syncGistRefreshTokenSetting)
	}
	if response.ExpiresIn > 0 {
		expiresAt := time.Now().UTC().Add(time.Duration(response.ExpiresIn) * time.Second)
		expiry, err := buildSyncSetting(syncGistTokenExpiresAtSetting, expiresAt.Format(time.RFC3339))
		if err != nil {
			return err
		}
		settings = append(settings, expiry)
	} else {
		deletes = append(deletes, syncGistTokenExpiresAtSetting)
	}
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin GitHub OAuth credential update: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := store.SetSettingsTx(tx, settings); err != nil {
		return err
	}
	if err := deleteSyncSettingsTx(tx, deletes); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *SyncService) ensureGistOAuthTokenFresh(ctx context.Context, input *model.SyncConfigInput) error {
	if input != nil && input.Gist.Token != "" {
		return nil
	}
	expiresAt, err := s.loadGistTokenExpiry()
	if err != nil || expiresAt.IsZero() || time.Now().Add(gistOAuthRefreshSkew).Before(expiresAt) {
		return err
	}
	refreshToken, err := s.loadOptionalSecret(syncGistRefreshTokenSetting)
	if err != nil {
		return err
	}
	if refreshToken == "" {
		return errors.New("GitHub authorization expired; reconnect GitHub in sync settings")
	}
	if strings.TrimSpace(s.gistOAuthClientID) == "" {
		return errors.New("GitHub OAuth is not configured")
	}
	response, err := s.refreshGistOAuthToken(ctx, refreshToken)
	if err != nil {
		return err
	}
	return s.storeGistOAuthCredentialsLocked(response)
}

func (s *SyncService) ensureGistOAuthForProvider(ctx context.Context, config model.SyncConfig, input *model.SyncConfigInput) error {
	if config.Provider != model.SyncProviderGist {
		return nil
	}
	return s.ensureGistOAuthTokenFresh(ctx, input)
}

func (s *SyncService) loadGistTokenExpiry() (time.Time, error) {
	var encoded string
	err := readSyncSetting(s.db, syncGistTokenExpiresAtSetting, &encoded)
	if errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, nil
	}
	if err != nil {
		return time.Time{}, err
	}
	expiresAt, err := time.Parse(time.RFC3339, encoded)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse GitHub OAuth token expiry: %w", err)
	}
	return expiresAt, nil
}

func (s *SyncService) refreshGistOAuthToken(ctx context.Context, refreshToken string) (gistTokenResponse, error) {
	endpoint := strings.TrimRight(s.gistOAuthWebBase, "/") + "/login/oauth/access_token"
	values := url.Values{
		"client_id":     {s.gistOAuthClientID},
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
	}
	var response gistTokenResponse
	if err := s.postGitHubOAuthForm(ctx, endpoint, values, &response); err != nil {
		return gistTokenResponse{}, err
	}
	if response.Error != "" {
		if response.Error == "bad_refresh_token" {
			return gistTokenResponse{}, errors.New("GitHub authorization expired; reconnect GitHub in sync settings")
		}
		return gistTokenResponse{}, errors.New(gistOAuthErrorMessage(response))
	}
	if strings.TrimSpace(response.AccessToken) == "" {
		return gistTokenResponse{}, errors.New("GitHub refresh returned an empty access token")
	}
	if strings.TrimSpace(response.RefreshToken) == "" {
		response.RefreshToken = refreshToken
	}
	return response, nil
}
