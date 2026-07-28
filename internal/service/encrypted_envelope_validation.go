package service

import (
	"encoding/base64"
	"fmt"
)

const aesGCMEnvelopeOverhead = 28

func maxBase64AESGCMEnvelopeBytes(maxPlaintextBytes int) int {
	return ((maxPlaintextBytes + aesGCMEnvelopeOverhead + 2) / 3) * 4
}

func validateBase64AESGCMEnvelope(payload string, maxPlaintextBytes int, label string) error {
	maxEncodedBytes := maxBase64AESGCMEnvelopeBytes(maxPlaintextBytes)
	if len(payload) > maxEncodedBytes {
		return fmt.Errorf("%s exceeds %d bytes", label, maxEncodedBytes)
	}
	decoded, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return fmt.Errorf("%s is not valid base64", label)
	}
	defer clear(decoded)
	if len(decoded) < aesGCMEnvelopeOverhead {
		return fmt.Errorf("%s is too short", label)
	}
	if len(decoded) > maxPlaintextBytes+aesGCMEnvelopeOverhead {
		return fmt.Errorf("%s is too large", label)
	}
	if base64.StdEncoding.EncodeToString(decoded) != payload {
		return fmt.Errorf("%s is not canonical base64", label)
	}
	return nil
}
