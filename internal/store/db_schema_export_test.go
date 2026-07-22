package store

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDatabaseFormatVersionExported(t *testing.T) {
	assert.Greater(t, DatabaseFormatVersion(), 0)
}
