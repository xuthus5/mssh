package service

import (
	"errors"
	"fmt"
	"sync"
	"time"
)

const (
	securityUnlockMaxFailures = 5
	securityUnlockLockout     = 30 * time.Second
)

var errUnlockRateLimited = errors.New("too many failed unlock attempts; try again later")

type unlockLimiter struct {
	mu          sync.Mutex
	failures    int
	lockedUntil time.Time
	now         func() time.Time
}

func newUnlockLimiter() *unlockLimiter {
	return &unlockLimiter{now: time.Now}
}

func (l *unlockLimiter) allow() error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if now.Before(l.lockedUntil) {
		remaining := l.lockedUntil.Sub(now).Round(time.Second)
		if remaining < time.Second {
			remaining = time.Second
		}
		return fmt.Errorf("%w (%s)", errUnlockRateLimited, remaining)
	}
	return nil
}

func (l *unlockLimiter) success() {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.failures = 0
	l.lockedUntil = time.Time{}
}

func (l *unlockLimiter) failure() {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.failures++
	if l.failures >= securityUnlockMaxFailures {
		l.lockedUntil = l.now().Add(securityUnlockLockout)
		l.failures = 0
	}
}
