package crypto

import (
	"crypto/cipher"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEncryptDecrypt(t *testing.T) {
	key, _, err := DeriveKey("test-password", nil)
	require.NoError(t, err)
	plaintext := []byte("sensitive data")
	encrypted, err := Encrypt(plaintext, key)
	require.NoError(t, err)
	assert.NotEqual(t, plaintext, encrypted)
	decrypted, err := Decrypt(encrypted, key)
	require.NoError(t, err)
	assert.Equal(t, plaintext, decrypted)
}

func TestDecryptWithWrongKey(t *testing.T) {
	key1, _, _ := DeriveKey("pass1", nil)
	key2, _, _ := DeriveKey("pass2", nil)
	encrypted, _ := Encrypt([]byte("data"), key1)
	_, err := Decrypt(encrypted, key2)
	assert.Error(t, err)
}

func TestDeriveKeyDeterministic(t *testing.T) {
	salt := []byte("1234567890123456")
	key1, _, _ := DeriveKey("password", salt)
	key2, _, _ := DeriveKey("password", salt)
	assert.Equal(t, key1, key2)
}

func TestGenerateRandomBytes(t *testing.T) {
	b, err := GenerateRandomBytes(32)
	require.NoError(t, err)
	assert.Len(t, b, 32)
}

func TestDecryptInvalidBase64(t *testing.T) {
	key, _, _ := DeriveKey("pass", nil)
	_, err := Decrypt([]byte("not-valid-base64!!!"), key)
	assert.Error(t, err)
}

func TestEncryptEmptyData(t *testing.T) {
	key, _, _ := DeriveKey("pass", nil)
	encrypted, err := Encrypt([]byte{}, key)
	require.NoError(t, err)
	decrypted, _ := Decrypt(encrypted, key)
	assert.Empty(t, decrypted)
}

func TestEncryptInvalidKeySize(t *testing.T) {
	_, err := Encrypt([]byte("data"), []byte("short"))
	assert.Error(t, err)
}

func TestDecryptInvalidKeySize(t *testing.T) {
	_, err := Decrypt([]byte("dGVzdA=="), []byte("short"))
	assert.Error(t, err)
}

func TestDecryptCiphertextTooShort(t *testing.T) {
	short := []byte("aA==")
	key, _, _ := DeriveKey("pass", nil)
	_, err := Decrypt(short, key)
	assert.Error(t, err)
}

func TestDeriveKeyWithProvidedSalt(t *testing.T) {
	key, salt, err := DeriveKey("password", nil)
	require.NoError(t, err)
	assert.Len(t, key, keyLen)
	assert.Len(t, salt, saltLen)
}

func TestDecryptGCMOpenError(t *testing.T) {
	key, _, _ := DeriveKey("pass", nil)
	enc, _ := Encrypt([]byte("data"), key)
	enc[len(enc)-1] ^= 0xFF
	_, err := Decrypt(enc, key)
	assert.Error(t, err)
}

func TestGenerateRandomBytesError(t *testing.T) {
	origReader := randReader
	randReader = &errorReader{}
	defer func() { randReader = origReader }()

	_, err := GenerateRandomBytes(32)
	assert.Error(t, err)
}

func TestDeriveKeyRandomError(t *testing.T) {
	origReader := randReader
	randReader = &errorReader{}
	defer func() { randReader = origReader }()

	_, _, err := DeriveKey("pass", nil)
	assert.Error(t, err)
}

func TestEncryptRandomError(t *testing.T) {
	origReader := randReader
	randReader = &errorReader{}
	defer func() { randReader = origReader }()

	key, _, _ := DeriveKey("pass", []byte("1234567890123456"))
	_, err := Encrypt([]byte("data"), key)
	assert.Error(t, err)
}

func TestEncryptNewGCMError(t *testing.T) {
	origGCM := newGCM
	newGCM = func(_ cipher.Block) (cipher.AEAD, error) {
		return nil, errors.New("gcm error")
	}
	defer func() { newGCM = origGCM }()

	key, _, _ := DeriveKey("pass", []byte("1234567890123456"))
	_, err := Encrypt([]byte("data"), key)
	assert.Error(t, err)
}

func TestDecryptNewGCMError(t *testing.T) {
	key, _, _ := DeriveKey("pass", []byte("1234567890123456"))
	enc, _ := Encrypt([]byte("data"), key)

	origGCM := newGCM
	newGCM = func(_ cipher.Block) (cipher.AEAD, error) {
		return nil, errors.New("gcm error")
	}
	defer func() { newGCM = origGCM }()

	_, err := Decrypt(enc, key)
	assert.Error(t, err)
}

type errorReader struct{}

func (e *errorReader) Read(_ []byte) (int, error) {
	return 0, errors.New("read error")
}
