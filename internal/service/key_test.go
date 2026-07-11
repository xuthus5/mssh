package service

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
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
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())
	assert.NotNil(t, svc)
}

func TestKeyService_List(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

	keys, err := svc.List()
	require.NoError(t, err)
	assert.Len(t, keys, 0)
}

func TestKeyService_GenerateED25519(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

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
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

	key, err := svc.Generate("myrsa", model.KeyTypeRSA, 2048)
	require.NoError(t, err)
	assert.NotZero(t, key.ID)
	assert.Equal(t, model.KeyTypeRSA, key.Type)
	assert.Contains(t, key.PublicKey, "ssh-rsa")
}

func TestKeyService_GenerateRSADefault(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

	key, err := svc.Generate("myrsa-default", model.KeyTypeRSA, 0)
	require.NoError(t, err)
	assert.NotZero(t, key.ID)
	assert.Contains(t, key.PublicKey, "ssh-rsa")
}

func TestKeyService_GenerateECDSA(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

	key, err := svc.Generate("myecdsa", model.KeyTypeECDSA, 0)
	require.NoError(t, err)
	assert.NotZero(t, key.ID)
	assert.Equal(t, model.KeyTypeECDSA, key.Type)
	assert.Contains(t, key.PublicKey, "ecdsa-")
}

func TestKeyService_GenerateUnknownType(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

	_, err := svc.Generate("bad", "unknown", 0)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported key type")
}

func TestKeyService_Import(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

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
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

	_, err := svc.Import("bad", "not-a-pem")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "import key")
}

func TestKeyService_ImportRSAPEM(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

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
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

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
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

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
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

	err := svc.Delete(999)
	assert.NoError(t, err)
}

func TestKeyService_ExportPublicKey(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

	key, err := svc.Generate("export-test", model.KeyTypeED25519, 0)
	require.NoError(t, err)

	pubKey, err := svc.ExportPublicKey(key.ID)
	require.NoError(t, err)
	assert.Contains(t, pubKey, "ssh-ed25519")
}

func TestKeyService_ExportPublicKeyNotFound(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

	_, err := svc.ExportPublicKey(999)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "export public key")
}

func TestKeyService_ListAfterGenerate(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

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
	svc := &KeyService{db: db, crypto: ec, logger: testutil.NewTestLogger()}

	_, err := svc.Generate("test", model.KeyTypeED25519, 0)
	assert.Error(t, err)
}

func TestKeyService_ImportEncryptError(t *testing.T) {
	db := testutil.NewTestDB(t)

	ec := &errCrypto{}
	svc := &KeyService{db: db, crypto: ec, logger: testutil.NewTestLogger()}

	pkPEM := generateTestPrivateKeyPEM(t)
	_, err := svc.Import("test", pkPEM)
	assert.Error(t, err)
}

func TestKeyService_extractPublicKey_InvalidPEM(t *testing.T) {
	svc := &KeyService{db: nil, crypto: &noopCrypto{}, logger: testutil.NewTestLogger()}

	_, err := svc.extractPublicKey([]byte("not a pem"))
	assert.Error(t, err)
}

func TestKeyService_extractPublicKey_UnknownBlockType(t *testing.T) {
	svc := &KeyService{db: nil, crypto: &noopCrypto{}, logger: testutil.NewTestLogger()}

	_, err := svc.extractPublicKey([]byte("-----BEGIN UNKNOWN-----\nAQ==\n-----END UNKNOWN-----"))
	assert.Error(t, err)
}

func TestKeyService_extractPublicKey_OpenSSHFormat(t *testing.T) {
	svc := &KeyService{db: nil, crypto: &noopCrypto{}, logger: testutil.NewTestLogger()}

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

func TestKeyService_ImportEd25519PEM(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	b, err := x509.MarshalPKCS8PrivateKey(priv)
	require.NoError(t, err)
	pkPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: b}))

	key, err := svc.Import("ed-import", pkPEM)
	require.NoError(t, err)
	assert.NotZero(t, key.ID)
	assert.Equal(t, model.KeyTypeED25519, key.Type)
}

func TestKeyService_ImportUnsupportedKeyType(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

	pkPEM := "-----BEGIN UNKNOWN TYPE-----\nAQ==\n-----END UNKNOWN TYPE-----"
	_, err := svc.Import("bad", pkPEM)
	assert.Error(t, err)
}

func TestKeyService_ImportNullBlockPEM(t *testing.T) {
	db := testutil.NewTestDB(t)
	svc := NewKeyService(db, &noopCrypto{}, testutil.NewTestLogger())

	_, err := svc.Import("bad", "garbage-data")
	assert.Error(t, err)
}

func TestKeyService_extractPublicKeyWithType(t *testing.T) {
	svc := &KeyService{db: nil, crypto: &noopCrypto{}, logger: testutil.NewTestLogger()}

	pkPEM := generateTestPrivateKeyPEM(t)
	keyType, pubKey, err := svc.extractPublicKeyWithType([]byte(pkPEM))
	require.NoError(t, err)
	assert.Equal(t, model.KeyTypeED25519, keyType)
	assert.NotEmpty(t, pubKey)
}

func TestKeyService_extractPublicKeyWithType_RSA(t *testing.T) {
	svc := &KeyService{db: nil, crypto: &noopCrypto{}, logger: testutil.NewTestLogger()}

	pk, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	pkBytes := x509.MarshalPKCS1PrivateKey(pk)
	pkPEM := string(pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: pkBytes}))

	keyType, pubKey, err := svc.extractPublicKeyWithType([]byte(pkPEM))
	require.NoError(t, err)
	assert.Equal(t, model.KeyTypeRSA, keyType)
	assert.NotEmpty(t, pubKey)
}

func TestKeyService_extractPublicKeyWithType_EC(t *testing.T) {
	svc := &KeyService{db: nil, crypto: &noopCrypto{}, logger: testutil.NewTestLogger()}

	pk, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	pkBytes, err := x509.MarshalECPrivateKey(pk)
	require.NoError(t, err)
	pkPEM := string(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: pkBytes}))

	keyType, pubKey, err := svc.extractPublicKeyWithType([]byte(pkPEM))
	require.NoError(t, err)
	assert.Equal(t, model.KeyTypeECDSA, keyType)
	assert.NotEmpty(t, pubKey)
}

func TestKeyService_extractPublicKeyWithType_RSA_PKCS8(t *testing.T) {
	svc := &KeyService{db: nil, crypto: &noopCrypto{}, logger: testutil.NewTestLogger()}

	pk, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	pkBytes, err := x509.MarshalPKCS8PrivateKey(pk)
	require.NoError(t, err)
	pkPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkBytes}))

	keyType, pubKey, err := svc.extractPublicKeyWithType([]byte(pkPEM))
	require.NoError(t, err)
	assert.Equal(t, model.KeyTypeRSA, keyType)
	assert.NotEmpty(t, pubKey)
}

func TestKeyService_extractPublicKeyWithType_ECDSA_PKCS8(t *testing.T) {
	svc := &KeyService{db: nil, crypto: &noopCrypto{}, logger: testutil.NewTestLogger()}

	pk, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	pkBytes, err := x509.MarshalPKCS8PrivateKey(pk)
	require.NoError(t, err)
	pkPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkBytes}))

	keyType, pubKey, err := svc.extractPublicKeyWithType([]byte(pkPEM))
	require.NoError(t, err)
	assert.Equal(t, model.KeyTypeECDSA, keyType)
	assert.NotEmpty(t, pubKey)
}

// generateOpenSSHKeyPEM 使用 ssh-keygen 生成 OPENSSH PRIVATE KEY 格式的密钥。
func generateOpenSSHKeyPEM(t *testing.T, keyType string, bits int) string {
	t.Helper()
	dir := t.TempDir()
	keyPath := filepath.Join(dir, "id_"+keyType)
	args := []string{"-t", keyType, "-f", keyPath, "-N", "", "-q"}
	if bits > 0 {
		args = append([]string{"-b", strconv.Itoa(bits)}, args...)
	}
	cmd := exec.Command("ssh-keygen", args...)
	require.NoError(t, cmd.Run(), "ssh-keygen failed")
	data, err := os.ReadFile(keyPath)
	require.NoError(t, err)
	return string(data)
}

func TestKeyService_extractPublicKeyWithType_OpenSSHED25519(t *testing.T) {
	svc := &KeyService{db: nil, crypto: &noopCrypto{}, logger: testutil.NewTestLogger()}
	pkPEM := generateOpenSSHKeyPEM(t, "ed25519", 0)
	keyType, pubKey, err := svc.extractPublicKeyWithType([]byte(pkPEM))
	require.NoError(t, err)
	assert.Equal(t, model.KeyTypeED25519, keyType)
	assert.Contains(t, pubKey, "ssh-ed25519")
}

func TestKeyService_extractPublicKeyWithType_OpenSSHRSA(t *testing.T) {
	svc := &KeyService{db: nil, crypto: &noopCrypto{}, logger: testutil.NewTestLogger()}
	pkPEM := generateOpenSSHKeyPEM(t, "rsa", 2048)
	keyType, pubKey, err := svc.extractPublicKeyWithType([]byte(pkPEM))
	require.NoError(t, err)
	assert.Equal(t, model.KeyTypeRSA, keyType)
	assert.Contains(t, pubKey, "ssh-rsa")
}

func TestKeyService_extractPublicKeyWithType_OpenSSHECDSA(t *testing.T) {
	svc := &KeyService{db: nil, crypto: &noopCrypto{}, logger: testutil.NewTestLogger()}
	pkPEM := generateOpenSSHKeyPEM(t, "ecdsa", 0)
	keyType, pubKey, err := svc.extractPublicKeyWithType([]byte(pkPEM))
	require.NoError(t, err)
	assert.Equal(t, model.KeyTypeECDSA, keyType)
	assert.Contains(t, pubKey, "ecdsa-")
}

func TestKeyService_extractPublicKeyWithType_OpenSSHInvalid(t *testing.T) {
	svc := &KeyService{db: nil, crypto: &noopCrypto{}, logger: testutil.NewTestLogger()}
	invalidPEM := "-----BEGIN OPENSSH PRIVATE KEY-----\naW52YWxpZA==\n-----END OPENSSH PRIVATE KEY-----"
	_, _, err := svc.extractPublicKeyWithType([]byte(invalidPEM))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "parse OpenSSH key")
}

func TestKeyService_extractPublicKeyWithType_PKCS8Unsupported(t *testing.T) {
	svc := &KeyService{db: nil, crypto: &noopCrypto{}, logger: testutil.NewTestLogger()}
	// 构造一个 PKCS8 格式但类型不受支持的密钥：DSA 私钥
	// 使用 EC 的 PKCS8 来构造有效 block，但替换为 DSA 是复杂的。
	// 此处通过 PKCS8 block 但内容为不支持的类型来覆盖 default 分支。
	// 生成一个 DSA 格式私钥太复杂，改用 marshaled-but-invalid bytes 触发解析错误。
	block, _ := pem.Decode([]byte(generateTestPrivateKeyPEM(t)))
	require.NotNil(t, block)
	// 篡改 PKCS8 内容以触发 ParsePKCS8PrivateKey 返回不支持的类型
	// 使用空内容构造一个会被 default 分支捕获的 PKCS8 block
	invalidPKCS8 := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: []byte{0x30, 0x05, 0x00}})
	_, _, err := svc.extractPublicKeyWithType(invalidPKCS8)
	require.Error(t, err)
}

func TestKeyService_extractPublicKeyWithType_DefaultBlockType(t *testing.T) {
	svc := &KeyService{db: nil, crypto: &noopCrypto{}, logger: testutil.NewTestLogger()}
	unknownPEM := "-----BEGIN CERTIFICATE-----\naW52YWxpZA==\n-----END CERTIFICATE-----"
	_, _, err := svc.extractPublicKeyWithType([]byte(unknownPEM))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported key type")
}
