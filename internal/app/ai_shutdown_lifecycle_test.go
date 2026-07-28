package app

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/store"
)

type appBlockingAIKeychain struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (k *appBlockingAIKeychain) Get(_, _ string) ([]byte, error) {
	k.once.Do(func() { close(k.started) })
	<-k.release
	return []byte("secret"), nil
}

func (k *appBlockingAIKeychain) Set(_, _ string, _ []byte) error { return nil }

func (k *appBlockingAIKeychain) Delete(_, _ string) error { return nil }

func (k *appBlockingAIKeychain) IsAvailable() bool { return true }

func TestAppShutdownWaitsForAIServiceBeforeClosingDatabase(t *testing.T) {
	database, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(database))
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte("{\"choices\":[{\"message\":{\"content\":\"OK\"}}]}"))
	}))
	t.Cleanup(server.Close)
	keychain := &appBlockingAIKeychain{started: make(chan struct{}), release: make(chan struct{})}
	t.Cleanup(func() {
		select {
		case <-keychain.release:
		default:
			close(keychain.release)
		}
	})
	aiService := service.NewAIService(database, nil, keychain, DefaultTestLogger(t))
	provider, err := store.SaveAIProviderProfile(database, model.AIProviderProfileInput{
		Name: "shutdown", Provider: model.AIProviderOpenAICompatible,
		BaseURL: server.URL, DefaultModel: "model", Enabled: true,
	})
	require.NoError(t, err)

	requestDone := make(chan error, 1)
	go func() { requestDone <- aiService.TestProvider(provider.ID) }()
	<-keychain.started
	shutdownDone := make(chan struct{})
	go func() {
		(&App{DB: database, AI: aiService, logger: DefaultTestLogger(t)}).Shutdown()
		close(shutdownDone)
	}()

	select {
	case <-shutdownDone:
		t.Fatal("app shutdown returned before the active AI operation completed")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, database.Ping())
	close(keychain.release)
	requestErr := <-requestDone
	require.Error(t, requestErr)
	assert.ErrorContains(t, requestErr, "context canceled")
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("app shutdown did not finish after the AI operation completed")
	}
	assert.Error(t, database.Ping())
	_, err = aiService.Dashboard()
	assert.ErrorContains(t, err, "AI service is shutting down")
}
