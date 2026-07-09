package service

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"mssh/internal/model"
	"mssh/internal/service/testutil"
)

type noopCrypto struct{}

func (n *noopCrypto) Encrypt(plaintext []byte) ([]byte, error) {
	return plaintext, nil
}

func (n *noopCrypto) Decrypt(ciphertext []byte) ([]byte, error) {
	return ciphertext, nil
}

type errCrypto struct{}

func (e *errCrypto) Encrypt(_ []byte) ([]byte, error) {
	return nil, assert.AnError
}

func (e *errCrypto) Decrypt(_ []byte) ([]byte, error) {
	return nil, assert.AnError
}

func TestNewKeyService(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{})
	assert.NotNil(t, svc)
}

func TestKeyService_List(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{})

	keys, err := svc.List()
	require.NoError(t, err)
	assert.Len(t, keys, 0)
}

func TestKeyService_GenerateED25519(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{})

	key, err := svc.Generate("mykey", model.KeyTypeED25519, 0)
	require.NoError(t, err)
	assert.NotZero(t, key.ID)
	assert.Equal(t, "mykey", key.Name)
	assert.Equal(t, model.KeyTypeED25519, key.Type)
	assert.NotEmpty(t, key.PrivateKey)
	assert.NotEmpty(t, key.PublicKey)
	assert.Contains(t, key.PublicKey, "ssh-ed25519")
}

func TestKeyService_GenerateRSA(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{})

	key, err := svc.Generate("myrsa", model.KeyTypeRSA, 2048)
	require.NoError(t, err)
	assert.NotZero(t, key.ID)
	assert.Equal(t, model.KeyTypeRSA, key.Type)
	assert.Contains(t, key.PublicKey, "ssh-rsa")
}

func TestKeyService_GenerateRSADefault(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{})

	key, err := svc.Generate("myrsa-default", model.KeyTypeRSA, 0)
	require.NoError(t, err)
	assert.NotZero(t, key.ID)
	assert.Contains(t, key.PublicKey, "ssh-rsa")
}

func TestKeyService_GenerateECDSA(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{})

	key, err := svc.Generate("myecdsa", model.KeyTypeECDSA, 0)
	require.NoError(t, err)
	assert.NotZero(t, key.ID)
	assert.Equal(t, model.KeyTypeECDSA, key.Type)
	assert.Contains(t, key.PublicKey, "ecdsa-")
}

func TestKeyService_GenerateUnknownType(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{})

	_, err := svc.Generate("bad", "unknown", 0)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported key type")
}

func TestKeyService_Import(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{})

	pkPEM := generateTestPrivateKeyPEM(t)

	key, err := svc.Import("imported", pkPEM)
	require.NoError(t, err)
	assert.NotZero(t, key.ID)
	assert.Equal(t, "imported", key.Name)
	assert.NotEmpty(t, key.PublicKey)
	assert.NotEmpty(t, key.PrivateKey)
}

func TestKeyService_ImportInvalidPEM(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{})

	_, err := svc.Import("bad", "not-a-pem")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "import key")
}

func TestKeyService_ImportRSAPEM(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{})

	pk, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	pkBytes := x509.MarshalPKCS1PrivateKey(pk)
	pkPEM := string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: pkBytes}))

	key, err := svc.Import("rsa-import", pkPEM)
	require.NoError(t, err)
	assert.NotZero(t, key.ID)
}

func TestKeyService_ImportECPEM(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{})

	pk, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	pkBytes, err := x509.MarshalECPrivateKey(pk)
	require.NoError(t, err)
	pkPEM := string(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: pkBytes}))

	key, err := svc.Import("ec-import", pkPEM)
	require.NoError(t, err)
	assert.NotZero(t, key.ID)
}

func TestKeyService_Delete(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{})

	key, err := svc.Generate("todelete", model.KeyTypeED25519, 0)
	require.NoError(t, err)

	err = svc.Delete(key.ID)
	require.NoError(t, err)

	keys, err := svc.List()
	require.NoError(t, err)
	assert.Len(t, keys, 0)
}

func TestKeyService_DeleteNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{})

	err := svc.Delete(999)
	assert.NoError(t, err)
}

func TestKeyService_ExportPublicKey(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{})

	key, err := svc.Generate("export-test", model.KeyTypeED25519, 0)
	require.NoError(t, err)

	pubKey, err := svc.ExportPublicKey(key.ID)
	require.NoError(t, err)
	assert.Contains(t, pubKey, "ssh-ed25519")
}

func TestKeyService_ExportPublicKeyNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{})

	_, err := svc.ExportPublicKey(999)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "export public key")
}

func TestKeyService_ListAfterGenerate(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{})

	_, err := svc.Generate("k1", model.KeyTypeED25519, 0)
	require.NoError(t, err)
	_, err = svc.Generate("k2", model.KeyTypeRSA, 2048)
	require.NoError(t, err)

	keys, err := svc.List()
	require.NoError(t, err)
	assert.GreaterOrEqual(t, len(keys), 2)
}

func TestKeyService_EncryptError(t *testing.T) {
	db := testutil.NewTestDB(t)

	ec := &errCrypto{}
	svc := &KeyService{db: db, crypto: ec}

	_, err := svc.Generate("test", model.KeyTypeED25519, 0)
	assert.Error(t, err)
}

func TestKeyService_ImportEncryptError(t *testing.T) {
	db := testutil.NewTestDB(t)

	ec := &errCrypto{}
	svc := &KeyService{db: db, crypto: ec}

	pkPEM := generateTestPrivateKeyPEM(t)
	_, err := svc.Import("test", pkPEM)
	assert.Error(t, err)
}

func TestKeyService_extractPublicKey_InvalidPEM(t *testing.T) {
	svc := &KeyService{db: nil, crypto: &noopCrypto{}}

	_, err := svc.extractPublicKey([]byte("not a pem"))
	assert.Error(t, err)
}

func TestKeyService_extractPublicKey_UnknownBlockType(t *testing.T) {
	svc := &KeyService{db: nil, crypto: &noopCrypto{}}

	_, err := svc.extractPublicKey([]byte("-----BEGIN UNKNOWN-----\nAQ==\n-----END UNKNOWN-----"))
	assert.Error(t, err)
}

func TestKeyService_extractPublicKey_OpenSSHFormat(t *testing.T) {
	svc := &KeyService{db: nil, crypto: &noopCrypto{}}

	pkPEM := generateTestPrivateKeyPEM(t)
	pubKey, err := svc.extractPublicKey([]byte(pkPEM))
	require.NoError(t, err)
	assert.NotEmpty(t, pubKey)
	assert.Contains(t, pubKey, "ssh-")
}

func generateTestPrivateKeyPEM(t *testing.T) string {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	b, err := x509.MarshalPKCS8PrivateKey(priv)
	require.NoError(t, err)
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: b}))
}
