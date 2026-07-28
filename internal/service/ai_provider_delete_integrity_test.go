package service

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

type aiRestoreFailingKeychain struct {
	data        map[string][]byte
	failRestore bool
}

func (k *aiRestoreFailingKeychain) Get(_, account string) ([]byte, error) {
	return append([]byte(nil), k.data[account]...), nil
}

func (k *aiRestoreFailingKeychain) Set(_, account string, data []byte) error {
	if k.failRestore {
		return errors.New("keychain restore failed")
	}
	k.data[account] = append([]byte(nil), data...)
	return nil
}

func (k *aiRestoreFailingKeychain) Delete(_, account string) error {
	delete(k.data, account)
	k.failRestore = true
	return nil
}

func (k *aiRestoreFailingKeychain) IsAvailable() bool { return true }

func TestAIServiceDeleteProviderRestoresSecretWhenDatabaseDeleteFails(t *testing.T) {
	db := testutil.NewTestDB(t)
	keychain := &aiMemoryKeychain{data: make(map[string][]byte), available: true}
	service := NewAIService(db, nil, keychain, testutil.NewTestLogger())
	provider, err := service.SaveProvider(model.AIProviderProfileInput{
		Name: "main", Provider: model.AIProviderOpenAICompatible,
		BaseURL: "https://api.openai.com/v1", DefaultModel: "model", Enabled: true, APIKey: "secret",
	})
	require.NoError(t, err)
	_, err = db.Exec(`CREATE TRIGGER fail_provider_delete BEFORE DELETE ON ai_provider_profiles BEGIN SELECT RAISE(ABORT, 'provider delete failed'); END`)
	require.NoError(t, err)
	require.ErrorContains(t, service.DeleteProvider(provider.ID), "provider delete failed")
	stored, err := store.GetAIProviderProfile(db, provider.ID)
	require.NoError(t, err)
	require.NotNil(t, stored)
	secret, exists, err := service.secrets.get(providerSecretAccount(provider.ID))
	require.NoError(t, err)
	assert.True(t, exists)
	assert.Equal(t, "secret", secret)
}

func TestAIServiceDeleteProviderReportsSessionOnlyCredentialRestore(t *testing.T) {
	db := testutil.NewTestDB(t)
	keychain := &aiRestoreFailingKeychain{data: make(map[string][]byte)}
	service := NewAIService(db, nil, keychain, testutil.NewTestLogger())
	provider, err := service.SaveProvider(model.AIProviderProfileInput{
		Name: "main", Provider: model.AIProviderOpenAICompatible,
		BaseURL: "https://api.openai.com/v1", DefaultModel: "model", Enabled: true, APIKey: "secret",
	})
	require.NoError(t, err)
	_, err = db.Exec(`CREATE TRIGGER fail_provider_delete_restore BEFORE DELETE ON ai_provider_profiles BEGIN SELECT RAISE(ABORT, 'provider delete failed'); END`)
	require.NoError(t, err)

	err = service.DeleteProvider(provider.ID)
	require.ErrorContains(t, err, "provider delete failed")
	require.ErrorContains(t, err, "current session")
	stored, loadErr := store.GetAIProviderProfile(db, provider.ID)
	require.NoError(t, loadErr)
	require.NotNil(t, stored)
	secret, saved, secretErr := service.secrets.get(providerSecretAccount(provider.ID))
	require.NoError(t, secretErr)
	assert.True(t, saved)
	assert.Equal(t, "secret", secret)
	credentialSaved, sessionOnly, stateErr := service.providerSecretState(provider.ID)
	require.NoError(t, stateErr)
	assert.True(t, credentialSaved)
	assert.True(t, sessionOnly)
}
