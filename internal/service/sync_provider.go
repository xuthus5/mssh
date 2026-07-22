package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"

	"github.com/xuthus5/mssh/internal/model"
)

var (
	errSyncRemoteNotFound = errors.New("sync remote backup not found")
	errSyncConflict       = errors.New("sync remote backup changed")
)

type syncRemoteObject struct {
	Content    []byte
	ETag       string
	ProviderID string
}

type syncProvider interface {
	Test(context.Context) error
	Fetch(context.Context) (syncRemoteObject, error)
	Put(context.Context, []byte, string) (syncRemoteObject, error)
}

type syncProviderSecrets struct {
	GistToken      string
	WebDAVPassword string
	S3SecretKey    string
}

type syncProviderFactory interface {
	Create(context.Context, model.SyncConfig, syncProviderSecrets) (syncProvider, error)
}

type defaultSyncProviderFactory struct {
	clientFactory func() *http.Client
}

type proxyAwareSyncProviderFactory struct {
	service *SyncService
}

func (f defaultSyncProviderFactory) Create(ctx context.Context, config model.SyncConfig, secrets syncProviderSecrets) (syncProvider, error) {
	clientFactory := f.clientFactory
	if clientFactory == nil {
		clientFactory = syncHTTPClient
	}
	return createSyncProvider(ctx, clientFactory(), config, secrets)
}

func (f proxyAwareSyncProviderFactory) Create(ctx context.Context, config model.SyncConfig, secrets syncProviderSecrets) (syncProvider, error) {
	return createSyncProvider(ctx, f.service.syncHTTPClient(), config, secrets)
}

func createSyncProvider(ctx context.Context, client *http.Client, config model.SyncConfig, secrets syncProviderSecrets) (syncProvider, error) {
	switch config.Provider {
	case model.SyncProviderGist:
		return newGistSyncProvider(client, "https://api.github.com", config.Gist.GistID, secrets.GistToken)
	case model.SyncProviderWebDAV:
		return newWebDAVSyncProvider(client, config.WebDAV.URL, config.WebDAV.Username, secrets.WebDAVPassword)
	case model.SyncProviderS3:
		return newS3SyncProvider(ctx, config.S3, secrets.S3SecretKey, client)
	default:
		return nil, fmt.Errorf("unsupported sync provider %s", config.Provider)
	}
}

func (s *SyncService) providerSecrets(config model.SyncConfig, input *model.SyncConfigInput) (syncProviderSecrets, error) {
	secrets := syncProviderSecrets{}
	var err error
	switch config.Provider {
	case model.SyncProviderGist:
		if input != nil && input.Gist.Token != "" {
			secrets.GistToken = input.Gist.Token
		} else {
			secrets.GistToken, err = s.loadOptionalSecret(syncGistTokenSetting)
		}
	case model.SyncProviderWebDAV:
		if input != nil && input.WebDAV.Password != "" {
			secrets.WebDAVPassword = input.WebDAV.Password
		} else if s.secretSaved(syncWebDAVPasswordSetting) {
			secrets.WebDAVPassword, err = s.loadSecret(syncWebDAVPasswordSetting)
		}
	case model.SyncProviderS3:
		if input != nil && input.S3.SecretKey != "" {
			secrets.S3SecretKey = input.S3.SecretKey
		} else {
			secrets.S3SecretKey, err = s.loadOptionalSecret(syncS3SecretSetting)
		}
	}
	if err != nil {
		return syncProviderSecrets{}, err
	}
	return secrets, nil
}

func (s *SyncService) loadOptionalSecret(key string) (string, error) {
	value, err := s.loadSecret(key)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return value, err
}

func validateProviderReady(config model.SyncConfig, secrets syncProviderSecrets) error {
	switch config.Provider {
	case model.SyncProviderGist:
		if secrets.GistToken == "" {
			return errors.New("GitHub token is required")
		}
	case model.SyncProviderWebDAV:
		if config.WebDAV.URL == "" {
			return errors.New("WebDAV URL is required")
		}
	case model.SyncProviderS3:
		if config.S3.Region == "" || config.S3.Bucket == "" || config.S3.AccessKeyID == "" || secrets.S3SecretKey == "" {
			return errors.New("S3 region, bucket, access key, and secret key are required")
		}
	}
	return nil
}
