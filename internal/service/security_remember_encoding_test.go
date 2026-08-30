package service

import (
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/crypto"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestRememberedDEKEncodingRoundTrip(t *testing.T) {
	dek := make([]byte, 32)
	for i := range dek {
		dek[i] = byte(0x80 + i%8)
	}
	encoded := encodeRememberedDEK(dek)
	require.True(t, strings.HasPrefix(string(encoded), rememberedDEKHexPrefix))
	decoded, ok := decodeRememberedDEK(encoded)
	require.True(t, ok)
	assert.Equal(t, dek, decoded)
}

func TestDecodeRememberedDEKRejectsInvalidStoredValues(t *testing.T) {
	dek := make([]byte, 32)
	for i := range dek {
		dek[i] = 0xFF
	}
	tests := []struct {
		name   string
		stored []byte
	}{
		{"legacy raw binary", dek},
		{"malformed hex", []byte(rememberedDEKHexPrefix + "zz")},
		{"wrong length", []byte(rememberedDEKHexPrefix + hex.EncodeToString([]byte("short")))},
		{"empty value", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			decoded, ok := decodeRememberedDEK(tt.stored)
			assert.False(t, ok)
			assert.Nil(t, decoded)
		})
	}
}

func TestSecurityService_PersistRememberedDEKStoresHexText(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	keychain := &memoryKeychain{}
	svc := NewSecurityService(db, dir, runtime, keychain, nil)

	_, err := svc.Setup(model.SecuritySetupInput{Password: "initial-pass-12", RememberUnlock: true})
	require.NoError(t, err)

	stored := keychain.data[securityKeychainDEKAccount]
	assert.True(t, strings.HasPrefix(string(stored), rememberedDEKHexPrefix))
	decoded, ok := decodeRememberedDEK(stored)
	require.True(t, ok)
	assert.Len(t, decoded, 32)
}

func TestSecurityService_TryAutoUnlockRestoresHexEncodedDEK(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	keychain := &memoryKeychain{}
	svc := NewSecurityService(db, dir, runtime, keychain, nil)

	_, err := svc.Setup(model.SecuritySetupInput{Password: "initial-pass-12", RememberUnlock: true})
	require.NoError(t, err)
	runtime.Clear()
	require.False(t, runtime.Unlocked())

	require.NoError(t, svc.TryAutoUnlock())
	require.True(t, runtime.Unlocked())
}

func TestSecurityService_TryAutoUnlockClearsLegacyRawDEK(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	keychain := &memoryKeychain{}
	svc := NewSecurityService(db, dir, runtime, keychain, nil)

	_, err := svc.Setup(model.SecuritySetupInput{Password: "initial-pass-12", RememberUnlock: true})
	require.NoError(t, err)

	// 注入旧格式的原始二进制 DEK 及匹配指纹，decode 失败时应清除。
	keychain.data = map[string][]byte{}
	legacyDEK := make([]byte, 32)
	for i := range legacyDEK {
		legacyDEK[i] = 0xAA
	}
	keychain.data[securityKeychainDEKAccount] = legacyDEK
	vault, loadErr := crypto.LoadVaultFile(crypto.VaultPath(dir))
	require.NoError(t, loadErr)
	fp, fpErr := vaultFingerprint(vault, legacyDEK)
	require.NoError(t, fpErr)
	keychain.data[securityKeychainVaultAccount] = []byte(fp)

	runtime.Clear()
	require.NoError(t, svc.TryAutoUnlock())
	assert.False(t, runtime.Unlocked())
	assert.NotContains(t, keychain.data, securityKeychainDEKAccount)
	assert.NotContains(t, keychain.data, securityKeychainVaultAccount)
}

type failingKeychain struct {
	memoryKeychain
	failAccount string
}

func (f *failingKeychain) Set(service, account string, data []byte) error {
	if account == f.failAccount {
		return errors.New("ksecretd rejects binary data")
	}
	return f.memoryKeychain.Set(service, account, data)
}

func TestSecurityService_EmitsRememberFailedWhenPersistFails(t *testing.T) {
	db := testutil.NewTestDB(t)
	dir := t.TempDir()
	runtime := NewCryptoRuntime()
	keychain := &failingKeychain{failAccount: securityKeychainDEKAccount}
	svc := NewSecurityService(db, dir, runtime, keychain, nil)
	bus := newMockEventBus()
	svc.SetEventBus(bus)

	_, err := svc.Setup(model.SecuritySetupInput{Password: "initial-pass-12", RememberUnlock: true})
	require.NoError(t, err)
	require.True(t, bus.hasEvent(securityVaultRememberFailedEvent))
}

func TestRememberedDEKEncodedBytesAreValidUTF8(t *testing.T) {
	dek := make([]byte, 32)
	for i := range dek {
		dek[i] = 0xFF
	}
	encoded := encodeRememberedDEK(dek)
	assert.True(t, utf8.Valid(encoded))
}
