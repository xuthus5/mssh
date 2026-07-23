package service

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestExportCSVWithPasswordsRequiresConfirmation(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	_, err := svc.CreateSession(model.SessionInputFrom(model.Session{
		Name: "s1", Host: "h", Port: 22, Username: "u", AuthMethod: model.AuthPassword,
		Password: "secret", KeepAlive: 30, TermType: "xterm",
	}))
	require.NoError(t, err)
	path := filepath.Join(t.TempDir(), "out.csv")

	_, err = svc.ExportCSV(path, model.SessionCSVExportOptions{IncludePasswords: true})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "application password")

	svc.SetPasswordVerifier(staticPasswordVerifier("good-pass"))
	_, err = svc.ExportCSV(path, model.SessionCSVExportOptions{IncludePasswords: true, ConfirmPassword: "bad"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "confirm application password")

	result, err := svc.ExportCSV(path, model.SessionCSVExportOptions{IncludePasswords: true, ConfirmPassword: "good-pass"})
	require.NoError(t, err)
	assert.Equal(t, 1, result.Count)
	assert.True(t, result.IncludedPasswords)
}

func TestSecurityVerifyPassword(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	svc := NewSecurityService(db, dir, runtime, &memoryKeychain{}, testutil.NewTestLogger())
	_, err := svc.Setup(model.SecuritySetupInput{Password: "initial-pass-12", RememberUnlock: false})
	require.NoError(t, err)

	require.NoError(t, svc.VerifyPassword("initial-pass-12"))
	assert.Error(t, svc.VerifyPassword("wrong-password"))
	assert.Error(t, svc.VerifyPassword(""))
}
