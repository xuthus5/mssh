package ssh

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"mssh/internal/model"
)

var ErrInvalidMagic = errors.New("invalid magic number")

type Player struct {
	Cols             int                    `json:"cols"`
	Rows             int                    `json:"rows"`
	TermType         string                 `json:"term_type"`
	RecordingEntries []model.RecordingEntry `json:"entries"`
	file             *os.File
}

func NewPlayer(path string) (*Player, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	p := &Player{file: f}
	if err := p.parseHeader(f); err != nil {
		_ = f.Close()
		return nil, err
	}
	if err := p.parseEntries(f); err != nil {
		_ = f.Close()
		return nil, err
	}
	return p, nil
}

const entryHeaderSize = 16

func (p *Player) parseHeader(r io.Reader) error {
	var magic uint64
	if err := binary.Read(r, binary.LittleEndian, &magic); err != nil {
		return fmt.Errorf("read magic: %w", err)
	}
	if magic != magicNumber {
		return ErrInvalidMagic
	}
	var version uint32
	if err := binary.Read(r, binary.LittleEndian, &version); err != nil {
		return fmt.Errorf("read version: %w", err)
	}
	if version != uint32(fileVersion) {
		return fmt.Errorf("unsupported file version %d", version)
	}
	var cols, rows uint32
	if err := binary.Read(r, binary.LittleEndian, &cols); err != nil {
		return fmt.Errorf("read cols: %w", err)
	}
	if err := binary.Read(r, binary.LittleEndian, &rows); err != nil {
		return fmt.Errorf("read rows: %w", err)
	}
	var termTypeLen uint32
	if err := binary.Read(r, binary.LittleEndian, &termTypeLen); err != nil {
		return fmt.Errorf("read term type length: %w", err)
	}
	termTypeBytes := make([]byte, termTypeLen)
	if termTypeLen > 0 {
		if _, err := io.ReadFull(r, termTypeBytes); err != nil {
			return fmt.Errorf("read term type: %w", err)
		}
	}
	p.Cols = int(cols)
	p.Rows = int(rows)
	p.TermType = string(termTypeBytes)
	return nil
}

func (p *Player) parseEntries(r io.Reader) error {
	for {
		entry, err := p.readEntry(r)
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		p.RecordingEntries = append(p.RecordingEntries, entry)
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
	ts := int64(binary.LittleEndian.Uint64(buf[0:8]))
	typ := binary.LittleEndian.Uint32(buf[8:12])
	dataLen := binary.LittleEndian.Uint32(buf[12:16])
	data := make([]byte, dataLen)
	if dataLen > 0 {
		if _, err := io.ReadFull(r, data); err != nil {
			return model.RecordingEntry{}, fmt.Errorf("truncated entry data: %w", err)
		}
	}
	return model.RecordingEntry{
		Timestamp: time.Duration(ts) * time.Millisecond,
		Type:      model.RecordType(typ),
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
	return p.file.Close()
}
