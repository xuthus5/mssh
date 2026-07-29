package ssh

import (
	"bufio"
	"encoding/binary"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

const (
	testMaxPlaybackFileBytes = 32 << 20
	testMaxPlaybackEntries   = 100_000
)

func TestPlayerRejectsOversizedRecordingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "oversized.msshlog")
	require.NoError(t, os.WriteFile(path, nil, 0o600))
	require.NoError(t, os.Truncate(path, testMaxPlaybackFileBytes+1))

	_, err := NewPlayer(path)

	require.Error(t, err)
	assert.ErrorContains(t, err, "exceeds")
}

func TestPlayerRejectsNonRegularRecordingPath(t *testing.T) {
	_, err := NewPlayer(t.TempDir())

	require.Error(t, err)
	assert.ErrorContains(t, err, "regular file")
}

func TestPlayerRejectsRecordingSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink permissions vary on Windows")
	}
	target := writeRecordingFixture(t, 5, 0, nil)
	link := filepath.Join(t.TempDir(), "recording-link.msshlog")
	require.NoError(t, os.Symlink(target, link))

	_, err := NewPlayer(link)

	require.Error(t, err)
	assert.ErrorContains(t, err, "regular file")
}

func TestPlayerClosesRecordingFileBeforeReturning(t *testing.T) {
	path := writeRecordingFixture(t, 5, 0, nil)

	player, err := NewPlayer(path)
	require.NoError(t, err)
	require.NotNil(t, player.file)
	_, statErr := player.file.Stat()
	assert.ErrorIs(t, statErr, os.ErrClosed)
	require.NoError(t, player.Close())
}

func TestPlayerRepairsRecordingPermissions(t *testing.T) {
	path := writeRecordingFixture(t, 5, 0, nil)
	require.NoError(t, os.Chmod(path, 0o644))

	player, err := NewPlayer(path)
	require.NoError(t, err)
	require.NoError(t, player.Close())
	info, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
}

func TestPlayerAcceptsMaximumEntryCount(t *testing.T) {
	path := writeRecordingWithEntries(t, testMaxPlaybackEntries, func(index int, header []byte) {
		binary.LittleEndian.PutUint64(header[0:8], uint64(index))
		binary.LittleEndian.PutUint32(header[8:12], uint32(model.RecordStdout))
	})

	player, err := NewPlayer(path)

	require.NoError(t, err)
	assert.Len(t, player.Entries(), testMaxPlaybackEntries)
}

func TestPlayerRejectsExcessiveEntryCount(t *testing.T) {
	path := writeRecordingWithEntries(t, testMaxPlaybackEntries+1, func(index int, header []byte) {
		binary.LittleEndian.PutUint64(header[0:8], uint64(index))
		binary.LittleEndian.PutUint32(header[8:12], uint32(model.RecordStdout))
	})

	_, err := NewPlayer(path)

	require.Error(t, err)
	assert.ErrorContains(t, err, "entry count")
}

func TestPlayerRejectsOutOfOrderEntries(t *testing.T) {
	path := writeRecordingWithEntries(t, 2, func(index int, header []byte) {
		timestamps := []uint64{2, 1}
		binary.LittleEndian.PutUint64(header[0:8], timestamps[index])
		binary.LittleEndian.PutUint32(header[8:12], uint32(model.RecordStdout))
	})

	_, err := NewPlayer(path)

	require.Error(t, err)
	assert.ErrorContains(t, err, "timestamp order")
}

func TestPlayerRejectsUnknownRecordType(t *testing.T) {
	path := writeRecordingWithEntries(t, 1, func(_ int, header []byte) {
		binary.LittleEndian.PutUint64(header[0:8], 1)
		binary.LittleEndian.PutUint32(header[8:12], 99)
	})

	_, err := NewPlayer(path)

	require.Error(t, err)
	assert.ErrorContains(t, err, "record type")
}

func TestPlayerRejectsOversizedTermType(t *testing.T) {
	path := writeRecordingFixture(t, 1<<20, 0, nil)

	_, err := NewPlayer(path)

	require.Error(t, err)
	assert.ErrorContains(t, err, "term type length")
}

func TestPlayerRejectsOversizedEntryData(t *testing.T) {
	path := writeRecordingFixture(t, 5, 0, nil)

	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	require.NoError(t, err)
	require.NoError(t, binary.Write(file, binary.LittleEndian, uint64(1)))
	require.NoError(t, binary.Write(file, binary.LittleEndian, model.RecordStdout))
	require.NoError(t, binary.Write(file, binary.LittleEndian, uint32(1<<20+1)))
	require.NoError(t, file.Close())

	_, err = NewPlayer(path)

	require.Error(t, err)
	assert.ErrorContains(t, err, "entry data length")
}

func TestPlayerRejectsEntryTruncatedAtEOF(t *testing.T) {
	path := writeRecordingFixture(t, 5, 0, nil)
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	require.NoError(t, err)
	require.NoError(t, binary.Write(file, binary.LittleEndian, uint64(1)))
	require.NoError(t, binary.Write(file, binary.LittleEndian, model.RecordStdout))
	require.NoError(t, binary.Write(file, binary.LittleEndian, uint32(4)))
	require.NoError(t, file.Close())

	_, err = NewPlayer(path)

	require.Error(t, err)
	assert.ErrorContains(t, err, "truncated entry data")
}

func TestPlayerRejectsTimestampOutsideJSONRange(t *testing.T) {
	path := writeRecordingFixture(t, 5, uint64(1)<<53, nil)

	_, err := NewPlayer(path)

	require.Error(t, err)
	assert.ErrorContains(t, err, "timestamp")
}

func TestPlayerAcceptsMaximumJSONSafeTimestamp(t *testing.T) {
	path := writeRecordingFixture(t, 5, uint64(1)<<53-1, nil)

	player, err := NewPlayer(path)

	require.NoError(t, err)
	require.Len(t, player.Entries(), 1)
	assert.Equal(t, int64(1<<53-1), player.Entries()[0].Timestamp)
}

func writeRecordingWithEntries(t *testing.T, count int, populate func(int, []byte)) string {
	t.Helper()
	path := writeRecordingFixture(t, 5, 0, nil)
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	require.NoError(t, err)
	writer := bufio.NewWriter(file)
	for index := 0; index < count; index++ {
		header := make([]byte, entryHeaderSize)
		populate(index, header)
		_, err = writer.Write(header)
		require.NoError(t, err)
	}
	require.NoError(t, writer.Flush())
	require.NoError(t, file.Close())
	return path
}

func TestRecorderRejectsUnsafeHeaderAndEntryValues(t *testing.T) {
	t.Run("negative dimensions", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "negative.msshlog")
		_, err := NewRecorder(path, -1, 24, "xterm")
		require.Error(t, err)
	})

	t.Run("dimensions outside uint32", func(t *testing.T) {
		if strconv.IntSize != 64 {
			t.Skip("int cannot exceed uint32 on this platform")
		}
		path := filepath.Join(t.TempDir(), "wide-dimensions.msshlog")
		_, err := NewRecorder(path, int(uint64(1)<<32), 24, "xterm")
		require.Error(t, err)
	})

	t.Run("oversized terminal type", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "term-type.msshlog")
		_, err := NewRecorder(path, 80, 24, string(make([]byte, 1<<10+1)))
		require.Error(t, err)
	})

	t.Run("oversized data", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "data.msshlog")
		recorder, err := NewRecorder(path, 80, 24, "xterm")
		require.NoError(t, err)
		t.Cleanup(func() { _ = recorder.Close() })

		err = recorder.Write(make([]byte, 1<<20+1), model.RecordStdout)
		require.Error(t, err)
	})
}

func TestRecorderRejectsNegativeElapsedTime(t *testing.T) {
	path := filepath.Join(t.TempDir(), "negative-time.msshlog")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	require.NoError(t, err)
	recorder := &Recorder{file: file, start: time.Now().Add(time.Hour)}
	t.Cleanup(func() { _ = file.Close() })

	err = recorder.Write([]byte("data"), model.RecordStdout)

	require.Error(t, err)
	assert.ErrorContains(t, err, "timestamp")
}

func TestRecordingDimensionConversionsRespectPlatformRanges(t *testing.T) {
	if strconv.IntSize == 64 {
		_, err := recordingDimensionValue(int(uint64(1)<<32), "cols")
		require.Error(t, err)
	}

	value := uint32(1) << 31
	converted, err := recordingDimensionInt(value, "rows")
	if strconv.IntSize == 32 {
		require.Error(t, err)
		return
	}
	require.NoError(t, err)
	assert.Equal(t, int(value), converted)
}

func writeRecordingFixture(t *testing.T, termTypeLength uint32, entryTimestamp uint64, entryData []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "fixture.msshlog")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	require.NoError(t, err)
	require.NoError(t, binary.Write(file, binary.LittleEndian, magicNumber))
	require.NoError(t, binary.Write(file, binary.LittleEndian, uint32(80)))
	require.NoError(t, binary.Write(file, binary.LittleEndian, uint32(24)))
	require.NoError(t, binary.Write(file, binary.LittleEndian, termTypeLength))
	if termTypeLength == 5 {
		_, err = file.Write([]byte("xterm"))
		require.NoError(t, err)
	}
	if entryTimestamp > 0 {
		require.NoError(t, binary.Write(file, binary.LittleEndian, entryTimestamp))
		require.NoError(t, binary.Write(file, binary.LittleEndian, model.RecordStdout))
		require.NoError(t, binary.Write(file, binary.LittleEndian, uint32(len(entryData))))
		if len(entryData) > 0 {
			_, err = file.Write(entryData)
			require.NoError(t, err)
		}
	}
	require.NoError(t, file.Close())
	return path
}
