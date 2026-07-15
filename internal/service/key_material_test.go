package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

type fakeKeyFilePicker struct {
	path      string
	err       error
	directory string
}

func (f *fakeKeyFilePicker) SelectPrivateKey(directory string) (string, error) {
	f.directory = directory
	return f.path, f.err
}

func TestKeyService_ListDoesNotSerializePrivateMaterial(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())
	_, err := svc.Generate("private-boundary", model.KeyTypeED25519, 0)
	require.NoError(t, err)

	keys, err := svc.List()
	require.NoError(t, err)
	encoded, err := json.Marshal(keys)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "private_key")
	assert.NotContains(t, string(encoded), "BEGIN PRIVATE KEY")
}

func TestKeyService_GetAndUpdateMaterial(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())
	generated, err := svc.Generate("before", model.KeyTypeED25519, 0)
	require.NoError(t, err)

	material, err := svc.GetMaterial(generated.ID)
	require.NoError(t, err)
	assert.Equal(t, generated.PrivateKey, material.PrivateKey)

	commentedPublicKey := strings.TrimSpace(material.PublicKey) + " user@example"
	updated, err := svc.Update(model.SSHKeyUpdateInput{ID: generated.ID, Name: "after", PrivateKey: material.PrivateKey, PublicKey: commentedPublicKey})
	require.NoError(t, err)
	assert.Equal(t, "after", updated.Name)
	assert.Equal(t, commentedPublicKey, updated.PublicKey)
	stored, err := store.GetKey(db, generated.ID)
	require.NoError(t, err)
	assert.Equal(t, "after", stored.Name)
	assert.Equal(t, commentedPublicKey, stored.PublicKey)
}

func TestKeyService_GetMaterialRejectsMissingKey(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

	_, err := svc.GetMaterial(999)
	assert.ErrorContains(t, err, "get key material")
}

func TestKeyService_UpdateValidatesInputAndStorage(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())
	privateKey := generateTestPrivateKeyPEM(t)
	publicKey, err := svc.extractPublicKey([]byte(privateKey))
	require.NoError(t, err)

	_, err = svc.Update(model.SSHKeyUpdateInput{Name: " ", PrivateKey: privateKey, PublicKey: publicKey})
	assert.ErrorContains(t, err, "key name is required")
	_, err = svc.Update(model.SSHKeyUpdateInput{Name: "invalid", PrivateKey: "not a key", PublicKey: publicKey})
	assert.ErrorContains(t, err, "invalid PEM")
	_, err = svc.Update(model.SSHKeyUpdateInput{ID: 999, Name: "missing", PrivateKey: privateKey, PublicKey: publicKey})
	assert.ErrorContains(t, err, "get key")
}

func TestKeyService_UpdateHandlesEncryptionFailure(t *testing.T) {
	db := testutil.NewTestDB(t)
	privateKey := generateTestPrivateKeyPEM(t)
	parser := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())
	publicKey, err := parser.extractPublicKey([]byte(privateKey))
	require.NoError(t, err)
	created, err := store.CreateKey(db, model.SSHKey{
		Name: "before", Type: model.KeyTypeED25519, PrivateKey: privateKey, PublicKey: publicKey,
	})
	require.NoError(t, err)
	svc := NewKeyService(db, &errCrypto{}, testutil.NewTestLogger())

	_, err = svc.Update(model.SSHKeyUpdateInput{
		ID: created.ID, Name: "after", PrivateKey: privateKey, PublicKey: publicKey,
	})
	assert.ErrorContains(t, err, "encrypt private key")
}

func TestKeyService_UpdateRejectsMismatchedPair(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())
	first, err := svc.Generate("first", model.KeyTypeED25519, 0)
	require.NoError(t, err)
	second, err := svc.Generate("second", model.KeyTypeED25519, 0)
	require.NoError(t, err)

	_, err = svc.Update(model.SSHKeyUpdateInput{ID: first.ID, Name: "invalid", PrivateKey: first.PrivateKey, PublicKey: second.PublicKey})
	assert.ErrorContains(t, err, "does not match")
	stored, getErr := store.GetKey(db, first.ID)
	require.NoError(t, getErr)
	assert.Equal(t, "first", stored.Name)
}

func TestKeyService_PrivateMaterialErrors(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &errCrypto{}, testutil.NewTestLogger())
	created, err := store.CreateKey(db, model.SSHKey{Name: "encrypted", Type: model.KeyTypeED25519, PrivateKey: "cipher", PublicKey: "ssh-ed25519 AAAA"})
	require.NoError(t, err)

	_, err = svc.GetMaterial(created.ID)
	assert.ErrorContains(t, err, "decrypt")
	_, err = svc.Update(model.SSHKeyUpdateInput{ID: created.ID, Name: "changed", PrivateKey: generateTestPrivateKeyPEM(t), PublicKey: created.PublicKey})
	assert.Error(t, err)
}

func TestKeyService_ImportFileHelpers(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	directory, err := defaultImportDirectory()
	require.NoError(t, err)
	assert.Equal(t, home, directory)
	sshDirectory := filepath.Join(home, ".ssh")
	require.NoError(t, os.Mkdir(sshDirectory, 0o700))
	directory, err = defaultImportDirectory()
	require.NoError(t, err)
	assert.Equal(t, sshDirectory, directory)

	path := filepath.Join(t.TempDir(), "id_ed25519")
	require.NoError(t, os.WriteFile(path, []byte("private material"), 0o600))
	file, err := readPrivateKeyFile(path)
	require.NoError(t, err)
	assert.Equal(t, "id_ed25519", file.Name)
	assert.Equal(t, "private material", file.PrivateKey)

	largePath := filepath.Join(t.TempDir(), "large-key")
	require.NoError(t, os.WriteFile(largePath, make([]byte, maxPrivateKeyFileSize+1), 0o600))
	_, err = readPrivateKeyFile(largePath)
	assert.ErrorContains(t, err, "too large")
	_, err = readPrivateKeyFile(t.TempDir())
	assert.ErrorContains(t, err, "regular file")
	_, err = readPrivateKeyFile(filepath.Join(t.TempDir(), "missing"))
	assert.ErrorContains(t, err, "read private key file")
}

func TestKeyService_SelectImportFileUsesTrustedPicker(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	path := filepath.Join(t.TempDir(), "id_ed25519")
	require.NoError(t, os.WriteFile(path, []byte("private material"), 0o600))
	picker := &fakeKeyFilePicker{path: path}
	svc := &KeyService{logger: testutil.NewTestLogger()}
	svc.SetFilePicker(picker)

	file, err := svc.SelectImportFile()
	require.NoError(t, err)
	assert.Equal(t, home, picker.directory)
	assert.Equal(t, "private material", file.PrivateKey)

	picker.path = ""
	file, err = svc.SelectImportFile()
	require.NoError(t, err)
	assert.Nil(t, file)
}

func TestKeyService_SelectImportFileErrors(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	svc := &KeyService{logger: testutil.NewTestLogger()}
	_, err := svc.SelectImportFile()
	assert.ErrorContains(t, err, "not configured")

	svc.picker = &fakeKeyFilePicker{err: assert.AnError}
	_, err = svc.SelectImportFile()
	assert.ErrorContains(t, err, "select private key file")
}

func TestKeyMaterialValidationHelpers(t *testing.T) {
	_, err := normalizedKeyName(" ")
	assert.ErrorContains(t, err, "required")
	assert.Equal(t, "key name", requireNormalizedKeyName(t, " key name "))

	privateKey := generateTestPrivateKeyPEM(t)
	svc := &KeyService{logger: testutil.NewTestLogger()}
	publicKey, err := svc.extractPublicKey([]byte(privateKey))
	require.NoError(t, err)
	_, err = matchingPublicKey("invalid", publicKey)
	assert.ErrorContains(t, err, "parse public key")
	_, err = matchingPublicKey(publicKey, "invalid")
	assert.ErrorContains(t, err, "parse derived public key")
	_, err = matchingPublicKey(publicKey+"\n"+publicKey, publicKey)
	assert.ErrorContains(t, err, "exactly one key")
}

func requireNormalizedKeyName(t *testing.T, name string) string {
	t.Helper()
	normalized, err := normalizedKeyName(name)
	require.NoError(t, err)
	return normalized
}
