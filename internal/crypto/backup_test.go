package crypto

import (
	"encoding/json"
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
