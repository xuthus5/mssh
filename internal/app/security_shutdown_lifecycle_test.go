package app

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/store"
)

func TestAppShutdownWaitsForSecurityPostUnlockWork(t *testing.T) {
	database, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(database))
	securityService := service.NewSecurityService(database, t.TempDir(), service.NewCryptoRuntime(), nil, DefaultTestLogger(t))
	callbackStarted := make(chan struct{})
	releaseCallback := make(chan struct{})
	t.Cleanup(func() {
		select {
		case <-releaseCallback:
		default:
			close(releaseCallback)
		}
	})
	securityService.SetAfterUnlock(func() {
		close(callbackStarted)
		<-releaseCallback
	})

	setupDone := make(chan error, 1)
	go func() {
		_, setupErr := securityService.Setup(model.SecuritySetupInput{Password: "shutdown-pass-12", RememberUnlock: false})
		setupDone <- setupErr
	}()
	<-callbackStarted
	shutdownDone := make(chan struct{})
	go func() {
		(&App{DB: database, Security: securityService, logger: DefaultTestLogger(t)}).Shutdown()
		close(shutdownDone)
	}()

	select {
	case <-shutdownDone:
		t.Fatal("app shutdown returned before security post-unlock work completed")
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, database.Ping())
	close(releaseCallback)
	require.NoError(t, <-setupDone)
	select {
	case <-shutdownDone:
	case <-time.After(time.Second):
		t.Fatal("app shutdown did not finish after security work completed")
	}
	assert.Error(t, database.Ping())
	_, err = securityService.Status()
	assert.ErrorContains(t, err, "security service is shutting down")
}
