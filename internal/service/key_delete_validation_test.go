package service

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestKeyServiceRejectsInvalidIDs(t *testing.T) {
	db, err := store.OpenDB(t.TempDir())
	require.NoError(t, err)
	require.NoError(t, store.InitializeSchema(db))
	t.Cleanup(func() { _ = db.Close() })
	svc := NewKeyService(db, nil, testutil.NewTestLogger())
	require.Error(t, svc.Delete(0))
	_, err = svc.UsageCount(0)
	require.Error(t, err)
	_, err = svc.ExportPublicKey(0)
	require.Error(t, err)
}
