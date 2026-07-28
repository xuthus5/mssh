package service

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestValidateSnapshotAcceptsValidSSHKeyRowsBeforeAndAfterJSON(t *testing.T) {
	database := testutil.NewTestDB(t)
	data, err := newTestSyncService(database, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	row := snapshotSSHKeyRow(t)
	row["has_passphrase"] = int64(1)
	data.Tables["ssh_keys"] = []map[string]any{row}
	require.NoError(t, validateSnapshot(database, data))

	content, err := json.Marshal(data)
	require.NoError(t, err)
	var decoded ExportData
	require.NoError(t, decodeSnapshot(content, &decoded))
	require.NoError(t, validateSnapshot(database, decoded))
}

func TestValidateSnapshotRejectsInvalidSSHKeySecurityFields(t *testing.T) {
	oversizedEnvelope := base64.StdEncoding.EncodeToString(
		make([]byte, maxPrivateKeyFileSize+aesGCMEnvelopeOverhead+1),
	)
	tests := []struct {
		name  string
		field string
		value any
	}{
		{name: "empty private key", field: "private_key", value: ""},
		{name: "plaintext private key", field: "private_key", value: "plaintext"},
		{name: "oversized stored private key", field: "private_key", value: strings.Repeat("A", maxStoredPrivateKeySize+1)},
		{name: "oversized private envelope", field: "private_key", value: oversizedEnvelope},
		{name: "malformed public key", field: "public_key", value: "ssh-ed25519 invalid"},
		{name: "oversized public key", field: "public_key", value: strings.Repeat("x", maxPublicKeyInputBytes+1)},
		{name: "public key contains nul", field: "public_key", value: "ssh-ed25519 AAAA\x00"},
		{name: "invalid public key utf8", field: "public_key", value: string([]byte{0xff})},
		{name: "mismatched public key type", field: "type", value: "rsa"},
		{name: "invalid passphrase flag", field: "has_passphrase", value: int64(2)},
	}
	assertSnapshotSSHKeyCasesRejected(t, tests)
}

func TestValidateSnapshotRejectsInvalidSSHKeyDataFields(t *testing.T) {
	tests := []struct {
		name  string
		field string
		value any
	}{
		{name: "invalid id", field: "id", value: int64(0)},
		{name: "oversized name", field: "name", value: strings.Repeat("k", keyNameLimit+1)},
		{name: "noncanonical name", field: "name", value: " deploy "},
		{name: "invalid name utf8", field: "name", value: string([]byte{0xff})},
		{name: "wrong name type", field: "name", value: int64(1)},
		{name: "unsupported type", field: "type", value: "dsa"},
		{name: "wrong key type field", field: "type", value: int64(1)},
		{name: "wrong private key type", field: "private_key", value: int64(1)},
		{name: "wrong public key type", field: "public_key", value: int64(1)},
		{name: "wrong passphrase type", field: "has_passphrase", value: "false"},
		{name: "invalid created at", field: "created_at", value: "invalid"},
		{name: "wrong created at type", field: "created_at", value: int64(1)},
	}
	assertSnapshotSSHKeyCasesRejected(t, tests)
}

func TestValidateSnapshotRejectsMissingAndDuplicateSSHKeyFields(t *testing.T) {
	database := testutil.NewTestDB(t)
	base, err := newTestSyncService(database, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	row := snapshotSSHKeyRow(t)

	for _, field := range []string{"id", "name", "type", "private_key", "public_key", "has_passphrase", "created_at"} {
		t.Run("missing "+field, func(t *testing.T) {
			missing := cloneSnapshotRow(row)
			delete(missing, field)
			data := snapshotWithSSHKeyRows(base, []map[string]any{missing})
			require.ErrorContains(t, validateSnapshot(database, data), field)
		})
	}

	data := snapshotWithSSHKeyRows(base, []map[string]any{row, cloneSnapshotRow(row)})
	require.Error(t, validateSnapshot(database, data))
}

func TestValidateSnapshotRejectsMultipleSSHKeysInPublicKeyField(t *testing.T) {
	database := testutil.NewTestDB(t)
	base, err := newTestSyncService(database, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	row := snapshotSSHKeyRow(t)
	row["public_key"] = row["public_key"].(string) + row["public_key"].(string)
	require.Error(t, validateSnapshot(database, snapshotWithSSHKeyRows(base, []map[string]any{row})))
}

func TestSnapshotPublicKeyTypeSupportsCommercialAlgorithms(t *testing.T) {
	for _, algorithm := range []string{
		"ssh-rsa", "ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521",
	} {
		_, err := snapshotPublicKeyType(algorithm)
		require.NoError(t, err)
	}
	_, err := snapshotPublicKeyType("ssh-dss")
	require.Error(t, err)
}

func assertSnapshotSSHKeyCasesRejected(
	t *testing.T,
	tests []struct {
		name  string
		field string
		value any
	},
) {
	t.Helper()
	database := testutil.NewTestDB(t)
	base, err := newTestSyncService(database, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			row := snapshotSSHKeyRow(t)
			row[test.field] = test.value
			require.Error(t, validateSnapshot(database, snapshotWithSSHKeyRows(base, []map[string]any{row})))
		})
	}
}

func snapshotSSHKeyRow(t *testing.T) map[string]any {
	t.Helper()
	privateKey := generateTestPrivateKeyPEM(t)
	keyType, publicKey, err := (&KeyService{}).extractPublicKeyWithType([]byte(privateKey))
	require.NoError(t, err)
	encrypted, err := testSessionPasswordRuntime().Encrypt([]byte(privateKey))
	require.NoError(t, err)
	return map[string]any{
		"id": int64(1), "name": "deploy", "type": string(keyType), "private_key": string(encrypted),
		"public_key": publicKey, "has_passphrase": int64(0), "created_at": "2026-07-28 12:00:00",
	}
}

func snapshotWithSSHKeyRows(base ExportData, rows []map[string]any) ExportData {
	data := base
	data.Tables = cloneSnapshotTables(base.Tables)
	data.Tables["ssh_keys"] = rows
	return data
}

func cloneSnapshotRow(row map[string]any) map[string]any {
	cloned := make(map[string]any, len(row))
	for key, value := range row {
		cloned[key] = value
	}
	return cloned
}
