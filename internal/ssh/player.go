package ssh

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"

	"github.com/xuthus5/mssh/internal/fsutil"
	"github.com/xuthus5/mssh/internal/model"
)

var ErrInvalidMagic = errors.New("invalid magic number")

type Player struct {
	Cols             int                    `json:"cols"`
	Rows             int                    `json:"rows"`
	TermType         string                 `json:"term_type"`
	RecordingEntries []model.RecordingEntry `json:"entries"`
	file             *os.File
	closeOnce        sync.Once
	closeErr         error
}

func NewPlayer(path string) (*Player, error) {
	f, err := openRecordingFile(path)
	if err != nil {
		return nil, err
	}
	p := &Player{file: f}
	reader := &io.LimitedReader{R: f, N: maxPlaybackRecordingBytes + 1}
	parseErr := p.parseHeader(reader)
	if parseErr == nil {
		parseErr = p.parseEntries(reader)
	}
	if reader.N == 0 {
		parseErr = errors.Join(recordingTooLargeError(), parseErr)
	}
	closeErr := p.Close()
	if closeErr != nil {
		closeErr = fmt.Errorf("close recording: %w", closeErr)
	}
	if parseErr != nil || closeErr != nil {
		return nil, errors.Join(parseErr, closeErr)
	}
	return p, nil
}

const entryHeaderSize = 16

func openRecordingFile(path string) (*os.File, error) {
	file, info, err := fsutil.OpenRegularFile(path)
	if err != nil {
		return nil, fmt.Errorf("open recording: %w", err)
	}
	if info.Size() > maxPlaybackRecordingBytes {
		return nil, closeRecordingFileWithError(file, recordingTooLargeError())
	}
	if err := file.Chmod(0o600); err != nil {
		return nil, closeRecordingFileWithError(file, fmt.Errorf("secure recording permissions: %w", err))
	}
	return file, nil
}

func closeRecordingFileWithError(file *os.File, err error) error {
	if closeErr := file.Close(); closeErr != nil {
		return errors.Join(err, fmt.Errorf("close recording: %w", closeErr))
	}
	return err
}

func recordingTooLargeError() error {
	return fmt.Errorf("recording exceeds %d bytes", maxPlaybackRecordingBytes)
}

func (p *Player) parseHeader(r io.Reader) error {
	var magic uint64
	if err := binary.Read(r, binary.LittleEndian, &magic); err != nil {
		return fmt.Errorf("read magic: %w", err)
	}
	if magic != magicNumber {
		return ErrInvalidMagic
	}
	var cols, rows uint32
	if err := binary.Read(r, binary.LittleEndian, &cols); err != nil {
		return fmt.Errorf("read cols: %w", err)
	}
	if err := binary.Read(r, binary.LittleEndian, &rows); err != nil {
		return fmt.Errorf("read rows: %w", err)
	}
	colsValue, err := recordingDimensionInt(cols, "cols")
	if err != nil {
		return err
	}
	rowsValue, err := recordingDimensionInt(rows, "rows")
	if err != nil {
		return err
	}
	var termTypeLen uint32
	if err := binary.Read(r, binary.LittleEndian, &termTypeLen); err != nil {
		return fmt.Errorf("read term type length: %w", err)
	}
	if termTypeLen > maxRecordingTermTypeBytes {
		return fmt.Errorf("recording term type length %d exceeds %d bytes", termTypeLen, maxRecordingTermTypeBytes)
	}
	termTypeBytes := make([]byte, int(termTypeLen))
	if termTypeLen > 0 {
		if _, err := io.ReadFull(r, termTypeBytes); err != nil {
			return fmt.Errorf("read term type: %w", err)
		}
	}
	p.Cols = colsValue
	p.Rows = rowsValue
	p.TermType = string(termTypeBytes)
	return nil
}

func (p *Player) parseEntries(r io.Reader) error {
	var previousTimestamp int64
	for {
		entry, err := p.readEntry(r)
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if len(p.RecordingEntries) >= maxPlaybackEntries {
			return fmt.Errorf("recording entry count exceeds %d", maxPlaybackEntries)
		}
		if len(p.RecordingEntries) > 0 && entry.Timestamp < previousTimestamp {
			return errors.New("recording entry timestamp order is invalid")
		}
		p.RecordingEntries = append(p.RecordingEntries, entry)
		previousTimestamp = entry.Timestamp
	}
}

func (p *Player) readEntry(r io.Reader) (model.RecordingEntry, error) {
	buf := make([]byte, entryHeaderSize)
	_, err := io.ReadFull(r, buf)
	if err != nil {
		if errors.Is(err, io.EOF) {
			return model.RecordingEntry{}, io.EOF
		}
		if errors.Is(err, io.ErrUnexpectedEOF) {
			return model.RecordingEntry{}, fmt.Errorf("truncated entry header")
		}
		return model.RecordingEntry{}, fmt.Errorf("read entry header: %w", err)
	}
	ts, err := recordingTimestamp(binary.LittleEndian.Uint64(buf[0:8]))
	if err != nil {
		return model.RecordingEntry{}, err
	}
	typ := binary.LittleEndian.Uint32(buf[8:12])
	dataLen := binary.LittleEndian.Uint32(buf[12:16])
	recordType := model.RecordType(typ)
	if recordType != model.RecordStdout && recordType != model.RecordStdin {
		return model.RecordingEntry{}, fmt.Errorf("unsupported recording record type %d", typ)
	}
	dataSize, err := recordingEntrySize(dataLen)
	if err != nil {
		return model.RecordingEntry{}, err
	}
	data := make([]byte, dataSize)
	if dataLen > 0 {
		if _, err := io.ReadFull(r, data); err != nil {
			return model.RecordingEntry{}, fmt.Errorf("truncated entry data: %w", err)
		}
	}
	return model.RecordingEntry{
		Timestamp: ts,
		Type:      recordType,
		Data:      data,
	}, nil
}

func (p *Player) Header() (cols, rows int, termType string) {
	return p.Cols, p.Rows, p.TermType
}

func (p *Player) Entries() []model.RecordingEntry {
	return p.RecordingEntries
}

func (p *Player) Close() error {
	if p == nil {
		return nil
	}
	p.closeOnce.Do(func() {
		if p.file != nil {
			p.closeErr = p.file.Close()
		}
	})
	return p.closeErr
}
