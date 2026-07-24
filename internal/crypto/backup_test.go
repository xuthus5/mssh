package crypto

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBackupEncryptionRoundTrip(t *testing.T) {
	envelope, err := EncryptBackup([]byte(`{"password":"secret"}`), []byte("correct horse battery staple"))
	require.NoError(t, err)
	assert.NotContains(t, envelope.Ciphertext, "secret")

	encoded, err := EncodeBackup(envelope)
	require.NoError(t, err)
	assert.True(t, json.Valid(encoded))

	plaintext, err := DecryptBackup(envelope, []byte("correct horse battery staple"))
	require.NoError(t, err)
	assert.JSONEq(t, `{"password":"secret"}`, string(plaintext))
}

func TestBackupEncryptionAuthenticatesAdditionalData(t *testing.T) {
	masterKey := []byte("correct horse battery staple")
	envelope, err := EncryptBackupWithAAD([]byte("data"), masterKey, []byte("metadata-v2"))
	require.NoError(t, err)

	plaintext, err := DecryptBackupWithAAD(envelope, masterKey, []byte("metadata-v2"))
	require.NoError(t, err)
	assert.Equal(t, []byte("data"), plaintext)

	_, err = DecryptBackupWithAAD(envelope, masterKey, []byte("tampered-metadata"))
	assert.ErrorContains(t, err, "corrupted backup")
}

func TestEncryptBackupRejectsOversizedPlaintext(t *testing.T) {
	_, err := EncryptBackup(make([]byte, backupMaxCiphertextLength), []byte("correct horse battery staple"))
	assert.ErrorContains(t, err, "plaintext length")
}

func TestBackupEncryptionRejectsInvalidKeysAndFormats(t *testing.T) {
	_, err := EncryptBackup([]byte("data"), []byte("short"))
	assert.Error(t, err)

	envelope, err := EncryptBackup([]byte("data"), []byte("correct horse battery staple"))
	require.NoError(t, err)
	_, err = DecryptBackup(envelope, []byte("incorrect master key"))
	assert.ErrorContains(t, err, "invalid master key")

	envelope.Cipher = "unknown"
	_, err = DecryptBackup(envelope, []byte("correct horse battery staple"))
	assert.ErrorContains(t, err, "unsupported")

	envelope, err = EncryptBackup([]byte("data"), []byte("correct horse battery staple"))
	require.NoError(t, err)
	envelope.Salt = "not-base64"
	_, err = DecryptBackup(envelope, []byte("correct horse battery staple"))
	assert.ErrorContains(t, err, "decode backup salt")
	envelope, err = EncryptBackup([]byte("data"), []byte("correct horse battery staple"))
	require.NoError(t, err)
	envelope.Nonce = "not-base64"
	_, err = DecryptBackup(envelope, []byte("correct horse battery staple"))
	assert.ErrorContains(t, err, "decode backup nonce")
	envelope, err = EncryptBackup([]byte("data"), []byte("correct horse battery staple"))
	require.NoError(t, err)
	envelope.Ciphertext = "not-base64"
	_, err = DecryptBackup(envelope, []byte("correct horse battery staple"))
	assert.ErrorContains(t, err, "decode backup ciphertext")
}

func TestDecryptBackupRejectsUnsafeEnvelopeWithoutPanic(t *testing.T) {
	masterKey := []byte("correct horse battery staple")
	valid, err := EncryptBackup([]byte("data"), masterKey)
	require.NoError(t, err)

	tests := []struct {
		name     string
		mutate   func(*BackupEnvelope)
		contains string
	}{
		{name: "zero argon time", mutate: func(envelope *BackupEnvelope) { envelope.ArgonTime = 0 }, contains: "KDF parameters"},
		{name: "different argon time", mutate: func(envelope *BackupEnvelope) { envelope.ArgonTime++ }, contains: "KDF parameters"},
		{name: "zero argon memory", mutate: func(envelope *BackupEnvelope) { envelope.ArgonMemory = 0 }, contains: "KDF parameters"},
		{name: "different argon memory", mutate: func(envelope *BackupEnvelope) { envelope.ArgonMemory++ }, contains: "KDF parameters"},
		{name: "zero argon threads", mutate: func(envelope *BackupEnvelope) { envelope.ArgonThreads = 0 }, contains: "KDF parameters"},
		{name: "different argon threads", mutate: func(envelope *BackupEnvelope) { envelope.ArgonThreads++ }, contains: "KDF parameters"},
		{name: "short salt", mutate: func(envelope *BackupEnvelope) {
			envelope.Salt = base64.StdEncoding.EncodeToString(make([]byte, backupSaltLength-1))
		}, contains: "salt length"},
		{name: "long salt", mutate: func(envelope *BackupEnvelope) {
			envelope.Salt = base64.StdEncoding.EncodeToString(make([]byte, backupSaltLength+1))
		}, contains: "salt length"},
		{name: "short nonce", mutate: func(envelope *BackupEnvelope) {
			envelope.Nonce = base64.StdEncoding.EncodeToString(make([]byte, backupNonceLength-1))
		}, contains: "nonce length"},
		{name: "long nonce", mutate: func(envelope *BackupEnvelope) {
			envelope.Nonce = base64.StdEncoding.EncodeToString(make([]byte, backupNonceLength+1))
		}, contains: "nonce length"},
		{name: "empty ciphertext", mutate: func(envelope *BackupEnvelope) { envelope.Ciphertext = "" }, contains: "ciphertext length"},
		{name: "short ciphertext", mutate: func(envelope *BackupEnvelope) {
			envelope.Ciphertext = base64.StdEncoding.EncodeToString(make([]byte, backupGCMTagLength-1))
		}, contains: "ciphertext length"},
		{name: "oversized ciphertext", mutate: func(envelope *BackupEnvelope) {
			const oversizedCiphertextBytes = 32*1024*1024 + 1
			envelope.Ciphertext = strings.Repeat("A", base64.StdEncoding.EncodedLen(oversizedCiphertextBytes))
		}, contains: "ciphertext length"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			envelope := valid
			test.mutate(&envelope)
			var decryptErr error
			assert.NotPanics(t, func() {
				_, decryptErr = DecryptBackup(envelope, masterKey)
			})
			assert.ErrorContains(t, decryptErr, test.contains)
		})
	}

	var decryptErr error
	assert.NotPanics(t, func() {
		_, decryptErr = DecryptBackup(valid, []byte("short"))
	})
	assert.ErrorContains(t, decryptErr, "master key")
}
