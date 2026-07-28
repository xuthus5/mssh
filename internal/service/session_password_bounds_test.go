package service

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testMaxSessionPasswordBytes = 64 * 1024

type sessionPasswordBoundsCrypto struct {
	encryptCalls  int
	decryptCalls  int
	encryptOutput []byte
	decryptOutput []byte
	encryptErr    error
	decryptErr    error
}

func (crypto *sessionPasswordBoundsCrypto) Encrypt([]byte) ([]byte, error) {
	crypto.encryptCalls++
	if crypto.encryptErr != nil {
		return nil, crypto.encryptErr
	}
	return append([]byte(nil), crypto.encryptOutput...), nil
}

func (crypto *sessionPasswordBoundsCrypto) Decrypt([]byte) ([]byte, error) {
	crypto.decryptCalls++
	if crypto.decryptErr != nil {
		return nil, crypto.decryptErr
	}
	return append([]byte(nil), crypto.decryptOutput...), nil
}

func TestSessionPasswordAcceptsExactPlaintextBoundary(t *testing.T) {
	runtime := testSessionPasswordRuntime()
	plain := strings.Repeat("p", testMaxSessionPasswordBytes)
	sealed, err := sealSessionPassword(runtime, plain)
	require.NoError(t, err)
	opened, err := openSessionPassword(runtime, sealed)
	require.NoError(t, err)
	assert.Equal(t, plain, opened)
}

func TestSealSessionPasswordRejectsInvalidInputsBeforeEncryption(t *testing.T) {
	crypto := &sessionPasswordBoundsCrypto{encryptOutput: []byte("unused")}
	_, err := sealSessionPassword(crypto, strings.Repeat("p", testMaxSessionPasswordBytes+1))
	require.Error(t, err)
	_, err = sealSessionPassword(crypto, string([]byte{0xff}))
	require.Error(t, err)
	assert.Zero(t, crypto.encryptCalls)
}

func TestSealSessionPasswordRejectsMalformedCiphertextOutput(t *testing.T) {
	crypto := &sessionPasswordBoundsCrypto{encryptOutput: []byte("not-base64!")}
	_, err := sealSessionPassword(crypto, "secret")
	require.Error(t, err)
	assert.Equal(t, 1, crypto.encryptCalls)
}

func TestSealSessionPasswordPropagatesEncryptionFailure(t *testing.T) {
	crypto := &sessionPasswordBoundsCrypto{encryptErr: assert.AnError}
	_, err := sealSessionPassword(crypto, "secret")
	require.ErrorIs(t, err, assert.AnError)
	assert.Equal(t, 1, crypto.encryptCalls)
}

func TestSealSessionPasswordRejectsOversizedCiphertextOutput(t *testing.T) {
	crypto := &sessionPasswordBoundsCrypto{encryptOutput: make([]byte, maxSessionPasswordPayloadBytes+1)}
	_, err := sealSessionPassword(crypto, "secret")
	require.ErrorContains(t, err, "exceeds")
	assert.Equal(t, 1, crypto.encryptCalls)
}

func TestOpenSessionPasswordRejectsMalformedStoredValuesBeforeDecryption(t *testing.T) {
	crypto := &sessionPasswordBoundsCrypto{decryptOutput: []byte("secret")}
	tests := []struct {
		name   string
		stored string
	}{
		{name: "invalid base64", stored: sessionPasswordPrefix + "not-base64!"},
		{name: "short envelope", stored: sessionPasswordPrefix + base64.StdEncoding.EncodeToString([]byte("short"))},
		{name: "oversized ciphertext", stored: sessionPasswordPrefix + strings.Repeat("A", 128*1024)},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := openSessionPassword(crypto, test.stored)
			require.Error(t, err)
		})
	}
	assert.Zero(t, crypto.decryptCalls)
}

func TestOpenSessionPasswordRejectsInvalidPlaintextAfterDecryption(t *testing.T) {
	validStored := testStoredSessionPassword(t, "secret")
	tests := []struct {
		name      string
		plaintext []byte
	}{
		{name: "oversized", plaintext: []byte(strings.Repeat("p", testMaxSessionPasswordBytes+1))},
		{name: "invalid utf8", plaintext: []byte{0xff}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			crypto := &sessionPasswordBoundsCrypto{decryptOutput: test.plaintext}
			_, err := openSessionPassword(crypto, validStored)
			require.Error(t, err)
			assert.Equal(t, 1, crypto.decryptCalls)
		})
	}
}

func TestOpenSessionPasswordPropagatesDecryptionFailure(t *testing.T) {
	crypto := &sessionPasswordBoundsCrypto{decryptErr: assert.AnError}
	_, err := openSessionPassword(crypto, testStoredSessionPassword(t, "secret"))
	require.ErrorIs(t, err, assert.AnError)
	assert.Equal(t, 1, crypto.decryptCalls)
}

func TestValidateStoredSessionPasswordRejectsDecodedBoundsAndNonCanonicalBase64(t *testing.T) {
	oversized := make([]byte, maxSessionPasswordBytes+sessionPasswordCiphertextOverhead+1)
	require.Error(t, validateStoredSessionPassword(sessionPasswordPrefix+base64.StdEncoding.EncodeToString(oversized)))

	canonical := base64.StdEncoding.EncodeToString(make([]byte, sessionPasswordCiphertextOverhead))
	nonCanonical := canonical[:len(canonical)-3] + "B=="
	require.ErrorContains(t, validateStoredSessionPassword(sessionPasswordPrefix+nonCanonical), "canonical")
}

func testSessionPasswordRuntime() *CryptoRuntime {
	runtime := NewCryptoRuntime()
	runtime.SetDEK([]byte("0123456789abcdef0123456789abcdef"))
	return runtime
}

func testStoredSessionPassword(t *testing.T, plain string) string {
	t.Helper()
	sealed, err := sealSessionPassword(testSessionPasswordRuntime(), plain)
	require.NoError(t, err)
	return sealed
}
