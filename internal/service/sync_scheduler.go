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
	s.schedulerMu.Lock()
	cancel := s.schedulerCancel
	s.schedulerCancel = nil
	s.schedulerMu.Unlock()
	if cancel != nil {
		cancel()
	}
	s.schedulerWG.Wait()
}

func (s *SyncService) restartScheduler() {
	s.StopScheduler()
	config, err := s.LoadConfig()
	if err != nil || !config.Enabled || config.IntervalMinutes == 0 {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.schedulerMu.Lock()
	s.schedulerCancel = cancel
	s.schedulerWG.Add(1)
	s.schedulerMu.Unlock()
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
