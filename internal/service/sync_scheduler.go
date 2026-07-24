package service

import (
	"context"
	"errors"
	"time"
)

const syncStartupDelay = 5 * time.Second

//wails:ignore
func (s *SyncService) StartScheduler() {
	s.restartScheduler()
}

//wails:ignore
func (s *SyncService) StopScheduler() {
	if s == nil {
		return
	}
	s.schedulerMu.Lock()
	s.schedulerStopped = true
	if s.schedulerStop != nil {
		s.schedulerStop()
		s.schedulerStop = nil
	}
	s.stopSchedulerLocked()
	s.schedulerMu.Unlock()
}

func (s *SyncService) stopSchedulerLocked() {
	cancel := s.schedulerCancel
	s.schedulerCancel = nil
	if cancel != nil {
		cancel()
	}
	s.schedulerWG.Wait()
}

// NotifyVaultUnlocked triggers a best-effort catch-up sync after the vault DEK becomes available.
// Safe to call when sync is disabled; skips quietly when vault/secret is still unavailable.
//
//wails:ignore
func (s *SyncService) NotifyVaultUnlocked() {
	if s == nil {
		return
	}
	s.schedulerMu.Lock()
	if s.schedulerStopped {
		s.schedulerMu.Unlock()
		return
	}
	s.schedulerWG.Add(1)
	ctx := s.schedulerContext
	if ctx == nil {
		ctx = context.Background()
	}
	s.schedulerMu.Unlock()
	go func() {
		defer s.schedulerWG.Done()
		s.runScheduledSync(ctx)
	}()
}

func (s *SyncService) restartScheduler() {
	s.schedulerMu.Lock()
	defer s.schedulerMu.Unlock()
	if s.schedulerStopped {
		return
	}
	s.stopSchedulerLocked()
	config, err := s.LoadConfig()
	if err != nil || !config.Enabled || config.IntervalMinutes == 0 {
		return
	}
	parent := s.schedulerContext
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	s.schedulerCancel = cancel
	s.schedulerWG.Add(1)
	go s.runScheduler(ctx, time.Duration(config.IntervalMinutes)*time.Minute)
}

func (s *SyncService) runScheduler(ctx context.Context, interval time.Duration) {
	defer s.schedulerWG.Done()
	timer := time.NewTimer(syncStartupDelay)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			s.runScheduledSync(ctx)
			timer.Reset(interval)
		}
	}
}

// runScheduledSync skips ticks while the application vault is locked so we do not
// spam SyncStateError / failed events before the user unlocks.
func (s *SyncService) runScheduledSync(ctx context.Context) {
	if err := s.ensureVaultReadyForSync(); err != nil {
		if s.logger != nil {
			s.logger.Debug("scheduled sync skipped", "reason", err.Error())
		}
		return
	}
	config, err := s.LoadConfig()
	if err != nil || !config.Enabled {
		return
	}
	_, _ = s.runSync(ctx, syncDirectionStrategy, "scheduled")
}

func (s *SyncService) ensureVaultReadyForSync() error {
	if s.secretSource == nil {
		return errors.New("application vault is locked or not configured")
	}
	key, err := s.secretSource()
	if err != nil {
		return err
	}
	if key == "" {
		return errors.New("application vault is locked or not configured")
	}
	return nil
}
