package service

import (
	"encoding/json"
	"fmt"
	"io"
)

func decodeBoundedJSON(reader io.Reader, maxBytes int64, output any) error {
	content, err := io.ReadAll(io.LimitReader(reader, maxBytes+1))
	if err != nil {
		return err
	}
	if int64(len(content)) > maxBytes {
		return fmt.Errorf("JSON response exceeds %d bytes", maxBytes)
	}
	return json.Unmarshal(content, output)
}
