package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSanitizeLogValue(t *testing.T) {
	assert.Equal(t, "ok", sanitizeLogValue("ok"))
	assert.Equal(t, "[REDACTED]", sanitizeLogValue("password=super-secret"))
	assert.Equal(t, "[REDACTED]", sanitizeLogValue("Authorization: Bearer abc.def"))
	assert.Equal(t, "[REDACTED]", sanitizeLogValue("api_key=xyz"))
}
