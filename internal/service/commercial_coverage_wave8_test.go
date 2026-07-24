package service

import (
	"context"
	"io"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/serial"
)

func TestProxyAwareSyncProviderFactoryCreate(t *testing.T) {
	svc := &SyncService{}
	factory := proxyAwareSyncProviderFactory{service: svc}
	_, err := factory.Create(context.Background(), model.SyncConfig{Provider: "nope"}, syncProviderSecrets{})
	require.Error(t, err)

	provider, err := factory.Create(context.Background(), model.SyncConfig{
		Provider: model.SyncProviderGist,
		Gist:     model.GistSyncConfig{GistID: "abc"},
	}, syncProviderSecrets{GistToken: "tok"})
	require.NoError(t, err)
	require.NotNil(t, provider)
}

func TestDefaultSyncProviderFactoryNilClientFactory(t *testing.T) {
	provider, err := (defaultSyncProviderFactory{}).Create(context.Background(), model.SyncConfig{
		Provider: model.SyncProviderGist,
		Gist:     model.GistSyncConfig{GistID: "g1"},
	}, syncProviderSecrets{GistToken: "t"})
	require.NoError(t, err)
	require.NotNil(t, provider)
}

func TestSerialSetExitCallbackAfterExit(t *testing.T) {
	session := serial.NewTestPortSession("/dev/ttyEXIT")
	require.NoError(t, session.Close())

	done := make(chan error, 1)
	session.SetExitCallback(func(err error) { done <- err })
	select {
	case err := <-done:
		require.ErrorIs(t, err, io.EOF)
	default:
		t.Fatal("expected late exit callback after Close")
	}
}
