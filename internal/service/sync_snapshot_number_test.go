package service

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

const largeSnapshotInteger = int64(1<<53 + 1)

func TestDecodeSnapshotPreservesSQLiteIntegerPrecision(t *testing.T) {
	db := testutil.NewTestDB(t)
	data, err := newTestSyncService(db, syncTestMasterKey).snapshot()
	require.NoError(t, err)
	data.Tables["sessions"] = []map[string]any{{"id": largeSnapshotInteger}}
	originalFingerprint, err := snapshotFingerprint(data)
	require.NoError(t, err)

	content, err := json.Marshal(data)
	require.NoError(t, err)
	var decoded ExportData
	require.NoError(t, decodeSnapshot(content, &decoded))

	value := decoded.Tables["sessions"][0]["id"]
	require.IsType(t, int64(0), value)
	assert.Equal(t, largeSnapshotInteger, value)
	decodedFingerprint, err := snapshotFingerprint(decoded)
	require.NoError(t, err)
	assert.Equal(t, originalFingerprint, decodedFingerprint)
}

func TestDecodeSnapshotRejectsNonSQLiteIntegerNumbers(t *testing.T) {
	tests := []struct {
		name    string
		value   any
		rewrite func([]byte) []byte
	}{
		{name: "fractional", value: 1.5},
		{name: "int64 overflow", value: uint64(1) << 63},
		{
			name:  "exponent notation",
			value: 1000,
			rewrite: func(content []byte) []byte {
				return bytes.Replace(content, []byte(`"id":1000`), []byte(`"id":1e3`), 1)
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := testutil.NewTestDB(t)
			data, err := newTestSyncService(db, syncTestMasterKey).snapshot()
			require.NoError(t, err)
			data.Tables["sessions"] = []map[string]any{{"id": test.value}}
			content, err := json.Marshal(data)
			require.NoError(t, err)
			if test.rewrite != nil {
				content = test.rewrite(content)
			}
			var decoded ExportData
			require.Error(t, decodeSnapshot(content, &decoded))
		})
	}
}
