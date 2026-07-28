package ssh

import (
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/xuthus5/mssh/internal/model"
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
	colsValue, err := recordingDimensionValue(cols, "cols")
	if err != nil {
		return nil, err
	}
	rowsValue, err := recordingDimensionValue(rows, "rows")
	if err != nil {
		return nil, err
	}
	termBytes, err := recordingTermTypeBytes(termType)
	if err != nil {
		return nil, err
	}
	// #nosec G304 -- O_EXCL prevents replacing an existing file, link, or special path.
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("create recording: %w", err)
	}
	if err := f.Chmod(0o600); err != nil {
		return nil, cleanupFailedRecorder(path, f, fmt.Errorf("secure recording: %w", err))
	}
	r := &Recorder{file: f, start: time.Now()}
	if err := r.writeHeader(colsValue, rowsValue, termBytes); err != nil {
		return nil, cleanupFailedRecorder(path, f, fmt.Errorf("write recording header: %w", err))
	}
	return r, nil
}

func cleanupFailedRecorder(path string, file *os.File, cause error) error {
	closeErr := file.Close()
	if closeErr != nil {
		closeErr = fmt.Errorf("close failed recording: %w", closeErr)
	}
	removeErr := os.Remove(path)
	if errors.Is(removeErr, os.ErrNotExist) {
		removeErr = nil
	} else if removeErr != nil {
		removeErr = fmt.Errorf("remove failed recording: %w", removeErr)
	}
	return errors.Join(cause, closeErr, removeErr)
}

func (r *Recorder) writeHeader(cols, rows uint32, termBytes []byte) error {
	termTypeLength, err := recordingTermTypeLength(len(termBytes))
	if err != nil {
		return err
	}
	if err := binary.Write(r.file, binary.LittleEndian, magicNumber); err != nil {
		return err
	}
	if err := binary.Write(r.file, binary.LittleEndian, fileVersion); err != nil {
		return err
	}
	if err := binary.Write(r.file, binary.LittleEndian, cols); err != nil {
		return err
	}
	if err := binary.Write(r.file, binary.LittleEndian, rows); err != nil {
		return err
	}
	if err := binary.Write(r.file, binary.LittleEndian, termTypeLength); err != nil {
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
	elapsed, err := recordingElapsed(r.start)
	if err != nil {
		return err
	}
	dataLength, err := recordingEntryLength(len(data))
	if err != nil {
		return err
	}
	buf := make([]byte, 16+len(data))
	binary.LittleEndian.PutUint64(buf[0:8], elapsed)
	binary.LittleEndian.PutUint32(buf[8:12], uint32(typ)) //nolint:gosec // RecordType is defined as uint32.
	binary.LittleEndian.PutUint32(buf[12:16], dataLength)
	copy(buf[16:], data)
	_, err = r.file.Write(buf)
	return err
}

func (r *Recorder) Close() error {
	return r.file.Close()
}
