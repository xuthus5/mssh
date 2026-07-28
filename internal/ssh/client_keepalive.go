package ssh

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

const keepAliveRequestTimeout = 10 * time.Second

var errKeepAliveTimedOut = errors.New("SSH keep-alive request timed out")

func (c *ClientWrapper) startKeepAlive(interval time.Duration, logger *slog.Logger) {
	c.startKeepAliveWithTimeout(interval, keepAliveRequestTimeout, logger)
}

func (c *ClientWrapper) startKeepAliveWithTimeout(interval, requestTimeout time.Duration, logger *slog.Logger) {
	if logger == nil {
		logger = slog.Default()
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	failCount := 0
	for {
		select {
		case <-ticker.C:
			err := c.sendKeepAliveRequest(requestTimeout)
			if err == nil {
				failCount = 0
				continue
			}
			if errors.Is(err, context.Canceled) {
				return
			}
			failCount++
			logger.Warn("keep-alive failed", "error", err, "failCount", failCount)
			if errors.Is(err, errKeepAliveTimedOut) || failCount >= 3 {
				logger.Error("keep-alive connection is unhealthy, closing connection")
				_ = c.closeConnection()
				return
			}
		case <-c.keepAliveDone():
			return
		}
	}
}

func (c *ClientWrapper) sendKeepAliveRequest(timeout time.Duration) error {
	if c == nil || c.Inner == nil {
		return fmt.Errorf("SSH client is unavailable")
	}
	if timeout <= 0 {
		return fmt.Errorf("SSH keep-alive timeout must be positive")
	}
	result := make(chan error, 1)
	go func() {
		_, _, err := c.Inner.SendRequest("keepalive@mssh", true, nil)
		result <- err
	}()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case err := <-result:
		return err
	case <-timer.C:
		closeErr := c.closeConnection()
		return errors.Join(errKeepAliveTimedOut, closeErr)
	case <-c.keepAliveDone():
		closeErr := c.closeConnection()
		return errors.Join(context.Canceled, closeErr)
	}
}

func (c *ClientWrapper) keepAliveDone() <-chan struct{} {
	if c == nil || c.keepAliveCtx == nil {
		return nil
	}
	return c.keepAliveCtx.Done()
}
