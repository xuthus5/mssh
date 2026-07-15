package store

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestCreateAndListKeys(t *testing.T) {
	db := setupTestDB(t)
	k := model.SSHKey{
		Name: "my-rsa-key", Type: model.KeyTypeRSA,
		PrivateKey: "-----BEGIN RSA PRIVATE KEY-----", PublicKey: "ssh-rsa AAA...",
		HasPassphrase: true,
	}
	created, err := CreateKey(db, k)
	require.NoError(t, err)
	assert.NotZero(t, created.ID)
	assert.Equal(t, "my-rsa-key", created.Name)

	keys, err := ListKeys(db)
	require.NoError(t, err)
	assert.Len(t, keys, 1)
	assert.Equal(t, "my-rsa-key", keys[0].Name)
	assert.Empty(t, keys[0].PrivateKey)
}

func TestGetKey(t *testing.T) {
	db := setupTestDB(t)
	k := model.SSHKey{
		Name:          "ed-key",
		Type:          model.KeyTypeED25519,
		PrivateKey:    "-----BEGIN PRIVATE KEY-----",
		PublicKey:     "ssh-ed25519 AAA...",
		HasPassphrase: false,
	}
	created, err := CreateKey(db, k)
	require.NoError(t, err)

	got, err := GetKey(db, created.ID)
	require.NoError(t, err)
	assert.Equal(t, "ed-key", got.Name)
	assert.Equal(t, model.KeyTypeED25519, got.Type)
	assert.False(t, got.HasPassphrase)
}

func TestGetKeyNotFound(t *testing.T) {
	db := setupTestDB(t)
	_, err := GetKey(db, 9999)
	assert.Error(t, err)
}

func TestDeleteKey(t *testing.T) {
	db := setupTestDB(t)
	k := model.SSHKey{
		Name: "temp-key", Type: model.KeyTypeECDSA,
		PrivateKey: "-----BEGIN EC PRIVATE KEY-----", PublicKey: "ssh-ecdsa AAA...",
	}
	created, err := CreateKey(db, k)
	require.NoError(t, err)

	err = DeleteKey(db, created.ID)
	require.NoError(t, err)

	keys, err := ListKeys(db)
	require.NoError(t, err)
	assert.Len(t, keys, 0)
}

func TestUpdateKeyMaterial(t *testing.T) {
	db := setupTestDB(t)
	created, err := CreateKey(db, model.SSHKey{Name: "before", Type: model.KeyTypeED25519, PrivateKey: "encrypted-before", PublicKey: "ssh-ed25519 before"})
	require.NoError(t, err)

	created.Name = "after"
	created.Type = model.KeyTypeRSA
	created.PrivateKey = "encrypted-after"
	created.PublicKey = "ssh-rsa after"
	require.NoError(t, UpdateKey(db, *created))

	updated, err := GetKey(db, created.ID)
	require.NoError(t, err)
	assert.Equal(t, "after", updated.Name)
	assert.Equal(t, model.KeyTypeRSA, updated.Type)
	assert.Equal(t, "encrypted-after", updated.PrivateKey)
	assert.Equal(t, "ssh-rsa after", updated.PublicKey)
}

func TestUpdateKeyRejectsMissingRecord(t *testing.T) {
	db := setupTestDB(t)
	err := UpdateKey(db, model.SSHKey{ID: 999, Name: "missing"})
	assert.ErrorContains(t, err, "not found")
}

func TestListKeysEmpty(t *testing.T) {
	db := setupTestDB(t)
	keys, err := ListKeys(db)
	require.NoError(t, err)
	assert.Len(t, keys, 0)
}

func TestGetKeyClosedDB(t *testing.T) {
	db := setupTestDB(t)
	db.Close()
	_, err := GetKey(db, 1)
	assert.Error(t, err)
}

func TestDeleteKeyClosedDB(t *testing.T) {
	db := setupTestDB(t)
	db.Close()
	err := DeleteKey(db, 1)
	assert.Error(t, err)
}

func TestListKeysClosedDB(t *testing.T) {
	db := setupTestDB(t)
	db.Close()
	_, err := ListKeys(db)
	assert.Error(t, err)
}
