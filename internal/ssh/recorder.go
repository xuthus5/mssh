package ssh

import (
	"encoding/binary"
	"os"
	"time"

	"mssh/internal/model"
)

const (
	magicNumber uint64 = 0x474F4C5F4853534D
	fileVersion uint32 = 1
)

type Recorder struct {
	file  *os.File
	start time.Time
}

func NewRecorder(path string, cols, rows int, termType string) (*Recorder, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return nil, err
	}
	r := &Recorder{file: f, start: time.Now()}
	if err := r.writeHeader(cols, rows, termType); err != nil {
		_ = f.Close()
		_ = os.Remove(path)
		return nil, err
	}
	return r, nil
}

func (r *Recorder) writeHeader(cols, rows int, termType string) error {
	if err := binary.Write(r.file, binary.LittleEndian, magicNumber); err != nil {
		return err
	}
	if err := binary.Write(r.file, binary.LittleEndian, fileVersion); err != nil {
		return err
	}
	if err := binary.Write(r.file, binary.LittleEndian, uint32(cols)); err != nil {
		return err
	}
	if err := binary.Write(r.file, binary.LittleEndian, uint32(rows)); err != nil {
		return err
	}
	termBytes := []byte(termType)
	if err := binary.Write(r.file, binary.LittleEndian, uint32(len(termBytes))); err != nil {
		return err
	}
	if len(termBytes) > 0 {
		if _, err := r.file.Write(termBytes); err != nil {
			return err
		}
	}
	return nil
}

func (r *Recorder) Write(data []byte, typ model.RecordType) error {
	elapsed := time.Since(r.start).Milliseconds()
	buf := make([]byte, 16+len(data))
	binary.LittleEndian.PutUint64(buf[0:8], uint64(elapsed))
	binary.LittleEndian.PutUint32(buf[8:12], uint32(typ))
	binary.LittleEndian.PutUint32(buf[12:16], uint32(len(data)))
	copy(buf[16:], data)
	_, err := r.file.Write(buf)
	return err
}

func (r *Recorder) Close() error {
	return r.file.Close()
}
