package app

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service"
	"github.com/xuthus5/mssh/internal/store"
)

func TestAppShutdownStopsUpdateChecksBeforeClosingDatabase(t *testing.T) {
	database, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(database))
	aboutService := service.NewAboutService()

	(&App{DB: database, About: aboutService, logger: DefaultTestLogger(t)}).Shutdown()

	assert.Error(t, database.Ping())
	canceledContext, cancel := context.WithCancel(t.Context())
	cancel()
	_, err = aboutService.CheckUpdate(canceledContext)
	require.ErrorContains(t, err, "about service is shutting down")
}
