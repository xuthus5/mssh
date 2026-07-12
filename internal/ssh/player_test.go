package ssh

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestNewPlayerFileNotFound(t *testing.T) {
	_, err := NewPlayer("/nonexistent/file.msshlog")
	assert.Error(t, err)
}

func TestNewPlayerInvalidMagic(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad_magic.msshlog")
	err := os.WriteFile(path, []byte("not valid"), 0o600)
	require.NoError(t, err)

	_, err = NewPlayer(path)
	assert.ErrorIs(t, err, ErrInvalidMagic)
}

func TestNewPlayerTruncatedHeader(t *testing.T) {
	path := filepath.Join(t.TempDir(), "trunc_header.msshlog")
	err := os.WriteFile(path, []byte("ab"), 0o600)
	require.NoError(t, err)

	_, err = NewPlayer(path)
	assert.Error(t, err)
}

func TestNewPlayerTruncatedEntryHeader(t *testing.T) {
	path := filepath.Join(t.TempDir(), "trunc_entry.msshlog")

	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	require.NoError(t, err)

	_ = binary.Write(f, binary.LittleEndian, magicNumber)
	_ = binary.Write(f, binary.LittleEndian, fileVersion)
	_ = binary.Write(f, binary.LittleEndian, uint32(80))
	_ = binary.Write(f, binary.LittleEndian, uint32(24))
	_ = binary.Write(f, binary.LittleEndian, uint32(5))
	_, _ = f.Write([]byte("xterm"))
	_, _ = f.Write([]byte{0x01})
	_ = f.Close()

	_, err = NewPlayer(path)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "truncated entry header")
}

func TestNewPlayerTruncatedEntryData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "trunc_data.msshlog")

	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	require.NoError(t, err)

	_ = binary.Write(f, binary.LittleEndian, magicNumber)
	_ = binary.Write(f, binary.LittleEndian, fileVersion)
	_ = binary.Write(f, binary.LittleEndian, uint32(80))
	_ = binary.Write(f, binary.LittleEndian, uint32(24))
	_ = binary.Write(f, binary.LittleEndian, uint32(5))
	_, _ = f.Write([]byte("xterm"))
	_ = binary.Write(f, binary.LittleEndian, uint64(1000))
	_ = binary.Write(f, binary.LittleEndian, uint32(0))
	_ = binary.Write(f, binary.LittleEndian, uint32(100))
	_, _ = f.Write([]byte("partial"))
	_ = f.Close()

	_, err = NewPlayer(path)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "truncated entry data")
}

func TestNewPlayerEmptyRecording(t *testing.T) {
	path := filepath.Join(t.TempDir(), "empty_rec.msshlog")
	r, err := NewRecorder(path, 80, 24, "vt100")
	require.NoError(t, err)
	err = r.Close()
	require.NoError(t, err)

	p, err := NewPlayer(path)
	require.NoError(t, err)
	defer func() { _ = p.Close() }()

	cols, rows, termType := p.Header()
	assert.Equal(t, 80, cols)
	assert.Equal(t, 24, rows)
	assert.Equal(t, "vt100", termType)
	assert.Empty(t, p.Entries())
}

func TestPlayerHeaderRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "header_rt.msshlog")
	r, err := NewRecorder(path, 120, 40, "xterm-256color")
	require.NoError(t, err)
	err = r.Close()
	require.NoError(t, err)

	p, err := NewPlayer(path)
	require.NoError(t, err)
	defer func() { _ = p.Close() }()

	cols, rows, termType := p.Header()
	assert.Equal(t, 120, cols)
	assert.Equal(t, 40, rows)
	assert.Equal(t, "xterm-256color", termType)
}

func TestPlayerHeaderEmptyTermType(t *testing.T) {
	path := filepath.Join(t.TempDir(), "empty_term_rt.msshlog")
	r, err := NewRecorder(path, 80, 24, "")
	require.NoError(t, err)
	err = r.Close()
	require.NoError(t, err)

	p, err := NewPlayer(path)
	require.NoError(t, err)
	defer func() { _ = p.Close() }()

	cols, rows, termType := p.Header()
	assert.Equal(t, 80, cols)
	assert.Equal(t, 24, rows)
	assert.Equal(t, "", termType)
}

func TestPlayerEntriesRoundTripStdout(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stdout_rt.msshlog")
	r, err := NewRecorder(path, 80, 24, "xterm")
	require.NoError(t, err)

	original := []byte("hello stdout world")
	err = r.Write(original, model.RecordStdout)
	require.NoError(t, err)
	err = r.Close()
	require.NoError(t, err)

	p, err := NewPlayer(path)
	require.NoError(t, err)
	defer func() { _ = p.Close() }()

	entries := p.Entries()
	require.Len(t, entries, 1)
	assert.Equal(t, model.RecordStdout, entries[0].Type)
	assert.Equal(t, original, entries[0].Data)
	assert.True(t, entries[0].Timestamp >= 0)
}

func TestPlayerEntryTimestampUsesMillisecondsForJSONPlayback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "timestamp_ms.msshlog")
	r, err := NewRecorder(path, 80, 24, "xterm")
	require.NoError(t, err)
	time.Sleep(2 * time.Millisecond)
	require.NoError(t, r.Write([]byte("output"), model.RecordStdout))
	require.NoError(t, r.Close())

	p, err := NewPlayer(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = p.Close() })
	require.Len(t, p.Entries(), 1)
	assert.Less(t, p.Entries()[0].Timestamp, int64(1000))
}

func TestPlayerEntriesRoundTripStdin(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stdin_rt.msshlog")
	r, err := NewRecorder(path, 80, 24, "xterm")
	require.NoError(t, err)

	original := []byte("ls -la\n")
	err = r.Write(original, model.RecordStdin)
	require.NoError(t, err)
	err = r.Close()
	require.NoError(t, err)

	p, err := NewPlayer(path)
	require.NoError(t, err)
	defer func() { _ = p.Close() }()

	entries := p.Entries()
	require.Len(t, entries, 1)
	assert.Equal(t, model.RecordStdin, entries[0].Type)
	assert.Equal(t, original, entries[0].Data)
}

func TestPlayerEntriesRoundTripMultipleM(t *testing.T) {
	path := filepath.Join(t.TempDir(), "multi_rt.msshlog")
	r, err := NewRecorder(path, 100, 30, "vt220")
	require.NoError(t, err)

	type entry struct {
		data []byte
		typ  model.RecordType
	}
	originals := []entry{
		{[]byte("output 1\n"), model.RecordStdout},
		{[]byte("input 1\n"), model.RecordStdin},
		{[]byte("output 2\n"), model.RecordStdout},
		{[]byte("input 2\n"), model.RecordStdin},
		{[]byte("output 3\n"), model.RecordStdout},
	}

	for _, e := range originals {
		err = r.Write(e.data, e.typ)
		require.NoError(t, err)
	}
	err = r.Close()
	require.NoError(t, err)

	p, err := NewPlayer(path)
	require.NoError(t, err)
	defer func() { _ = p.Close() }()

	entries := p.Entries()
	require.Len(t, entries, len(originals))

	for i, original := range originals {
		assert.Equal(t, original.typ, entries[i].Type, "entry %d type mismatch", i)
		assert.Equal(t, original.data, entries[i].Data, "entry %d data mismatch", i)
	}

	for i := 1; i < len(entries); i++ {
		assert.True(t, entries[i].Timestamp >= entries[i-1].Timestamp,
			"entries should be in timestamp order")
	}
}

func TestPlayerEntriesRoundTripLargeData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "large_rt.msshlog")
	r, err := NewRecorder(path, 80, 24, "xterm")
	require.NoError(t, err)

	largeData := make([]byte, 65536)
	for i := range largeData {
		largeData[i] = byte(i % 256)
	}
	err = r.Write(largeData, model.RecordStdout)
	require.NoError(t, err)
	err = r.Close()
	require.NoError(t, err)

	p, err := NewPlayer(path)
	require.NoError(t, err)
	defer func() { _ = p.Close() }()

	entries := p.Entries()
	require.Len(t, entries, 1)
	assert.Equal(t, largeData, entries[0].Data)
}

func TestPlayerEntriesRoundTripBinaryData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "binary_rt.msshlog")
	r, err := NewRecorder(path, 80, 24, "xterm")
	require.NoError(t, err)

	binaryData := []byte{0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD, 0x00, 0x7F}
	err = r.Write(binaryData, model.RecordStdout)
	require.NoError(t, err)
	err = r.Close()
	require.NoError(t, err)

	p, err := NewPlayer(path)
	require.NoError(t, err)
	defer func() { _ = p.Close() }()

	entries := p.Entries()
	require.Len(t, entries, 1)
	assert.Equal(t, binaryData, entries[0].Data)
}

func TestPlayerEntriesRoundTripEmptyData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "empty_data_rt.msshlog")
	r, err := NewRecorder(path, 80, 24, "xterm")
	require.NoError(t, err)

	err = r.Write([]byte{}, model.RecordStdout)
	require.NoError(t, err)
	err = r.Close()
	require.NoError(t, err)

	p, err := NewPlayer(path)
	require.NoError(t, err)
	defer func() { _ = p.Close() }()

	entries := p.Entries()
	require.Len(t, entries, 1)
	assert.Empty(t, entries[0].Data)
}

func TestPlayerEntriesTimestampOrder(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ts_order.msshlog")
	r, err := NewRecorder(path, 80, 24, "xterm")
	require.NoError(t, err)

	for i := 0; i < 100; i++ {
		err = r.Write([]byte("x"), model.RecordStdout)
		require.NoError(t, err)
	}
	err = r.Close()
	require.NoError(t, err)

	p, err := NewPlayer(path)
	require.NoError(t, err)
	defer func() { _ = p.Close() }()

	entries := p.Entries()
	for i := 1; i < len(entries); i++ {
		assert.True(t, entries[i].Timestamp >= entries[i-1].Timestamp,
			"entry %d is before entry %d", i, i-1)
	}
}

func TestPlayerClose(t *testing.T) {
	path := filepath.Join(t.TempDir(), "close_rt.msshlog")
	r, err := NewRecorder(path, 80, 24, "xterm")
	require.NoError(t, err)
	err = r.Close()
	require.NoError(t, err)

	p, err := NewPlayer(path)
	require.NoError(t, err)

	err = p.Close()
	assert.NoError(t, err)
}

func TestPlayerUnsupportedVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad_ver.msshlog")

	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	require.NoError(t, err)

	_ = binary.Write(f, binary.LittleEndian, magicNumber)
	_ = binary.Write(f, binary.LittleEndian, uint32(999))
	_ = f.Close()

	_, err = NewPlayer(path)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported file version")
}

func TestPlayerParseHeaderTruncatedAfterMagic(t *testing.T) {
	path := filepath.Join(t.TempDir(), "trunc_after_magic.msshlog")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	require.NoError(t, err)
	_ = binary.Write(f, binary.LittleEndian, magicNumber)
	_ = f.Close()

	_, err = NewPlayer(path)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "read version")
}

func TestPlayerParseHeaderTruncatedAfterVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "trunc_after_ver.msshlog")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	require.NoError(t, err)
	_ = binary.Write(f, binary.LittleEndian, magicNumber)
	_ = binary.Write(f, binary.LittleEndian, fileVersion)
	_ = f.Close()

	_, err = NewPlayer(path)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "read cols")
}

func TestPlayerParseHeaderTruncatedAfterCols(t *testing.T) {
	path := filepath.Join(t.TempDir(), "trunc_after_cols.msshlog")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	require.NoError(t, err)
	_ = binary.Write(f, binary.LittleEndian, magicNumber)
	_ = binary.Write(f, binary.LittleEndian, fileVersion)
	_ = binary.Write(f, binary.LittleEndian, uint32(80))
	_ = f.Close()

	_, err = NewPlayer(path)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "read rows")
}

func TestPlayerParseHeaderTruncatedAfterRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "trunc_after_rows.msshlog")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	require.NoError(t, err)
	_ = binary.Write(f, binary.LittleEndian, magicNumber)
	_ = binary.Write(f, binary.LittleEndian, fileVersion)
	_ = binary.Write(f, binary.LittleEndian, uint32(80))
	_ = binary.Write(f, binary.LittleEndian, uint32(24))
	_ = f.Close()

	_, err = NewPlayer(path)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "read term type length")
}

func TestPlayerParseHeaderTruncatedTermType(t *testing.T) {
	path := filepath.Join(t.TempDir(), "trunc_term_type.msshlog")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	require.NoError(t, err)
	_ = binary.Write(f, binary.LittleEndian, magicNumber)
	_ = binary.Write(f, binary.LittleEndian, fileVersion)
	_ = binary.Write(f, binary.LittleEndian, uint32(80))
	_ = binary.Write(f, binary.LittleEndian, uint32(24))
	_ = binary.Write(f, binary.LittleEndian, uint32(10))
	_ = f.Close()

	_, err = NewPlayer(path)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "read term type")
}
