package serial

import (
	"bytes"

	"github.com/xuthus5/mssh/internal/model"
)

// transformLineEnding rewrites newline sequences for the target serial device.
func transformLineEnding(data []byte, ending model.SerialLineEnding) []byte {
	if len(data) == 0 {
		return data
	}
	switch ending {
	case model.SerialLineEndingLF:
		return bytes.ReplaceAll(bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n")), []byte("\r"), []byte("\n"))
	case model.SerialLineEndingCRLF:
		normalized := bytes.ReplaceAll(bytes.ReplaceAll(data, []byte("\r\n"), []byte("\n")), []byte("\r"), []byte("\n"))
		return bytes.ReplaceAll(normalized, []byte("\n"), []byte("\r\n"))
	case model.SerialLineEndingCR, "":
		return bytes.ReplaceAll(bytes.ReplaceAll(data, []byte("\r\n"), []byte("\r")), []byte("\n"), []byte("\r"))
	default:
		return data
	}
}
