package service

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUserSelectedFileReadersFollowSymbolicLinks(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		expected string
		read     func(string) (string, error)
	}{
		{
			name:     "private key",
			content:  "private material",
			expected: "private material",
			read: func(path string) (string, error) {
				file, err := readPrivateKeyFile(path)
				if err != nil {
					return "", err
				}
				return file.PrivateKey, nil
			},
		},
		{
			name:     "session csv",
			content:  "name,host\nexample,127.0.0.1\n",
			expected: "127.0.0.1",
			read: func(path string) (string, error) {
				records, err := readSessionCSVRecords(path)
				if err != nil {
					return "", err
				}
				return records[1][1], nil
			},
		},
		{
			name:     "local backup",
			content:  "encrypted backup",
			expected: "encrypted backup",
			read: func(path string) (string, error) {
				content, err := readLocalBackup(path)
				return string(content), err
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			directory := t.TempDir()
			target := filepath.Join(directory, "target")
			require.NoError(t, os.WriteFile(target, []byte(test.content), 0o600))
			link := filepath.Join(directory, "selected")
			if err := os.Symlink(target, link); err != nil {
				t.Skipf("symbolic links unavailable: %v", err)
			}

			actual, err := test.read(link)

			require.NoError(t, err)
			assert.Equal(t, test.expected, actual)
		})
	}
}
