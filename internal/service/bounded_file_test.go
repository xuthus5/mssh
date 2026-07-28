package service

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/iotest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type boundedRegularFileStub struct {
	reader   io.Reader
	closeErr error
}

func (file *boundedRegularFileStub) Read(buffer []byte) (int, error) {
	return file.reader.Read(buffer)
}

func (file *boundedRegularFileStub) Close() error { return file.closeErr }

func TestReadBoundedRegularFileRejectsSymbolicLink(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(directory, "target")
	require.NoError(t, os.WriteFile(target, []byte("payload"), 0o600))
	link := filepath.Join(directory, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symbolic links unavailable: %v", err)
	}

	content, err := readBoundedRegularFile(link, "fixture", 64)

	assert.Nil(t, content)
	assert.ErrorContains(t, err, "regular file")
}

func TestFinishBoundedRegularFileReadPreservesReadAndCloseErrors(t *testing.T) {
	readErr := errors.New("read failed")
	closeErr := errors.New("close failed")
	file := &boundedRegularFileStub{reader: iotest.ErrReader(readErr), closeErr: closeErr}

	content, info, err := finishBoundedRegularFileRead(file, nil, "fixture", 64)

	assert.Nil(t, content)
	assert.Nil(t, info)
	assert.ErrorIs(t, err, readErr)
	assert.ErrorIs(t, err, closeErr)
}

func TestFinishBoundedRegularFileReadRejectsGrowthPastLimit(t *testing.T) {
	file := &boundedRegularFileStub{reader: strings.NewReader("12345")}

	content, info, err := finishBoundedRegularFileRead(file, nil, "fixture", 4)

	assert.Nil(t, content)
	assert.Nil(t, info)
	assert.ErrorContains(t, err, "exceeds 4 bytes")
}
