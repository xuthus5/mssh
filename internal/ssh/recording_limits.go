package ssh

import (
	"fmt"
	"time"
)

const (
	maxRecordingTermTypeBytes  = 1 << 10
	maxRecordingEntryDataBytes = 1 << 20
	maxRecordingUint32Value    = uint64(1<<32 - 1)
	maxRecordingTimestampValue = uint64(1<<53 - 1)
	maxPlaybackRecordingBytes  = int64(32 << 20)
	maxPlaybackEntries         = 100_000
)

func recordingDimensionValue(value int, name string) (uint32, error) {
	if value < 0 {
		return 0, fmt.Errorf("recording %s must not be negative", name)
	}
	unsignedValue := uint64(value) //nolint:gosec // negative values are rejected above.
	if unsignedValue > maxRecordingUint32Value {
		return 0, fmt.Errorf("recording %s exceeds uint32 range", name)
	}
	return uint32(unsignedValue), nil //nolint:gosec // bounded by maxRecordingUint32Value.
}

func recordingDimensionInt(value uint32, name string) (int, error) {
	maxInt := uint64(^uint(0) >> 1)
	if uint64(value) > maxInt {
		return 0, fmt.Errorf("recording %s cannot fit in int", name)
	}
	return int(value), nil //nolint:gosec // bounded by the native int maximum.
}

func recordingTermTypeBytes(termType string) ([]byte, error) {
	termBytes := []byte(termType)
	if _, err := recordingTermTypeLength(len(termBytes)); err != nil {
		return nil, err
	}
	return termBytes, nil
}

func recordingTermTypeLength(length int) (uint32, error) {
	if length > maxRecordingTermTypeBytes {
		return 0, fmt.Errorf("recording term type length %d exceeds %d bytes", length, maxRecordingTermTypeBytes)
	}
	return uint32(length), nil // #nosec G115 -- bounded by maxRecordingTermTypeBytes.
}

func recordingEntryLength(length int) (uint32, error) {
	if length > maxRecordingEntryDataBytes {
		return 0, fmt.Errorf("recording entry data length %d exceeds %d bytes", length, maxRecordingEntryDataBytes)
	}
	return uint32(length), nil // #nosec G115 -- bounded by maxRecordingEntryDataBytes.
}

func recordingEntrySize(length uint32) (int, error) {
	if length > maxRecordingEntryDataBytes {
		return 0, fmt.Errorf("recording entry data length %d exceeds %d bytes", length, maxRecordingEntryDataBytes)
	}
	return int(length), nil
}

func recordingTimestamp(value uint64) (int64, error) {
	if value > maxRecordingTimestampValue {
		return 0, fmt.Errorf("recording timestamp %d exceeds signed timestamp range", value)
	}
	return int64(value), nil //nolint:gosec // bounded by maxRecordingTimestampValue.
}

func recordingElapsed(start time.Time) (uint64, error) {
	elapsed := time.Since(start).Milliseconds()
	if elapsed < 0 {
		return 0, fmt.Errorf("recording timestamp cannot be negative")
	}
	return uint64(elapsed), nil //nolint:gosec // negative values are rejected above.
}
