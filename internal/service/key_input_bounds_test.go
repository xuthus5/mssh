package service

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

type observingKeyCrypto struct {
	decryptCalls int
}

type oversizedEncryptKeyCrypto struct{}

func (crypto *observingKeyCrypto) Encrypt(plaintext []byte) ([]byte, error) {
	return append([]byte(nil), plaintext...), nil
}

func (crypto *observingKeyCrypto) Decrypt([]byte) ([]byte, error) {
	crypto.decryptCalls++
	return []byte("small"), nil
}

func (oversizedEncryptKeyCrypto) Encrypt([]byte) ([]byte, error) {
	return make([]byte, maxStoredPrivateKeySize+1), nil
}

func (oversizedEncryptKeyCrypto) Decrypt(ciphertext []byte) ([]byte, error) {
	return append([]byte(nil), ciphertext...), nil
}

func TestKeyServiceImportRejectsOversizedPrivateKey(t *testing.T) {
	service := NewKeyService(testutil.NewTestDB(t), &noopCrypto{}, testutil.NewTestLogger())
	privateKey := padKeyInput(generateTestPrivateKeyPEM(t), maxPrivateKeyFileSize+1)

	created, err := service.Import("oversized", privateKey)

	assert.Nil(t, created)
	assert.ErrorContains(t, err, "private key exceeds")
}

func TestKeyServiceUpdateRejectsOversizedPrivateAndPublicKeys(t *testing.T) {
	database := testutil.NewTestDB(t)
	service := NewKeyService(database, &noopCrypto{}, testutil.NewTestLogger())
	created, err := service.Generate("before", model.KeyTypeED25519, 0)
	require.NoError(t, err)

	_, err = service.Update(model.SSHKeyUpdateInput{
		ID: created.ID, Name: "private-overflow",
		PrivateKey: padKeyInput(created.PrivateKey, maxPrivateKeyFileSize+1), PublicKey: created.PublicKey,
	})
	assert.ErrorContains(t, err, "private key exceeds")

	_, err = service.Update(model.SSHKeyUpdateInput{
		ID: created.ID, Name: "public-overflow", PrivateKey: created.PrivateKey,
		PublicKey: padKeyInput(created.PublicKey, maxPublicKeyInputBytes+1),
	})
	assert.ErrorContains(t, err, "public key exceeds")
	stored, getErr := store.GetKey(database, created.ID)
	require.NoError(t, getErr)
	assert.Equal(t, "before", stored.Name)
}

func TestKeyServiceImportRejectsTrailingPrivateKey(t *testing.T) {
	service := NewKeyService(testutil.NewTestDB(t), &noopCrypto{}, testutil.NewTestLogger())
	privateKey := generateTestPrivateKeyPEM(t)

	created, err := service.Import("ambiguous", privateKey+"\n"+privateKey)

	assert.Nil(t, created)
	assert.ErrorContains(t, err, "exactly one private key")
}

func TestKeyServiceGetMaterialRejectsOversizedDecryptedKey(t *testing.T) {
	database := testutil.NewTestDB(t)
	oversized := strings.Repeat("k", maxPrivateKeyFileSize+1)
	created, err := store.CreateKey(database, model.SSHKey{
		Name: "oversized", Type: model.KeyTypeED25519, PrivateKey: oversized, PublicKey: "ssh-ed25519 AAAA",
	})
	require.NoError(t, err)
	service := NewKeyService(database, &noopCrypto{}, testutil.NewTestLogger())

	material, err := service.GetMaterial(created.ID)

	assert.Nil(t, material)
	assert.ErrorContains(t, err, "private key exceeds")
}

func TestKeyServiceGetMaterialRejectsOversizedCiphertextBeforeDecrypt(t *testing.T) {
	database := testutil.NewTestDB(t)
	created, err := store.CreateKey(database, model.SSHKey{
		Name: "oversized-ciphertext", Type: model.KeyTypeED25519,
		PrivateKey: strings.Repeat("x", maxStoredPrivateKeySize+1), PublicKey: "ssh-ed25519 AAAA",
	})
	require.NoError(t, err)
	crypto := &observingKeyCrypto{}
	service := NewKeyService(database, crypto, testutil.NewTestLogger())

	material, err := service.GetMaterial(created.ID)

	assert.Nil(t, material)
	assert.ErrorContains(t, err, "encrypted private key exceeds")
	assert.Zero(t, crypto.decryptCalls)
}

func TestKeyServiceImportRejectsOversizedEncryptedPrivateKey(t *testing.T) {
	database := testutil.NewTestDB(t)
	service := NewKeyService(database, oversizedEncryptKeyCrypto{}, testutil.NewTestLogger())

	created, err := service.Import("oversized-ciphertext", generateTestPrivateKeyPEM(t))

	assert.Nil(t, created)
	assert.ErrorContains(t, err, "encrypted private key exceeds")
	keys, listErr := store.ListKeys(database)
	require.NoError(t, listErr)
	assert.Empty(t, keys)
}

func padKeyInput(value string, size int) string {
	return value + strings.Repeat(" ", size-len(value))
}
