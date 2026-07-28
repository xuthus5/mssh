package service

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSessionServiceNormalizeDeleteErrorTreatsDeferredCleanupAsSuccess(t *testing.T) {
	service := &SessionService{logger: testutil.NewTestLogger()}
	err := errors.Join(store.ErrRecordingCleanupDeferred, assert.AnError)

	assert.NoError(t, service.normalizeSessionDeleteError(err))
}

func TestSessionServiceNormalizeDeleteErrorPreservesDeleteFailure(t *testing.T) {
	service := &SessionService{logger: testutil.NewTestLogger()}

	assert.ErrorIs(t, service.normalizeSessionDeleteError(assert.AnError), assert.AnError)
}
