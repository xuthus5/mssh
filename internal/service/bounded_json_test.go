package service

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDecodeBoundedJSON(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		maxBytes int64
		wantOK   bool
		wantErr  string
	}{
		{
			name:     "accept exact limit",
			content:  `{"ok":true}`,
			maxBytes: int64(len(`{"ok":true}`)),
			wantOK:   true,
		},
		{
			name:     "reject malformed json",
			content:  `{"ok":`,
			maxBytes: int64(len(`{"ok":`)),
			wantErr:  "unexpected end",
		},
		{
			name:     "reject multiple json values",
			content:  `{"ok":true}{"ok":false}`,
			maxBytes: int64(len(`{"ok":true}{"ok":false}`)),
			wantErr:  "invalid character",
		},
		{
			name:     "reject oversized payload",
			content:  `{"ok":true}x`,
			maxBytes: int64(len(`{"ok":true}`)),
			wantErr:  "exceeds",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var output struct {
				OK bool `json:"ok"`
			}

			err := decodeBoundedJSON(strings.NewReader(test.content), test.maxBytes, &output)

			if test.wantErr != "" {
				assert.ErrorContains(t, err, test.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, test.wantOK, output.OK)
		})
	}
}

func TestDecodeBoundedJSONPropagatesReadError(t *testing.T) {
	var output map[string]any

	err := decodeBoundedJSON(boundedJSONErrorReader{}, 1024, &output)

	assert.ErrorIs(t, err, assert.AnError)
}

type boundedJSONErrorReader struct{}

func (boundedJSONErrorReader) Read([]byte) (int, error) {
	return 0, assert.AnError
}
