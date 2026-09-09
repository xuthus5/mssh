package ssh

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"sync"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

// handshakeDeadline 只计初始握手的网络耗时，不计本地主机密钥校验与人工等待。
type handshakeDeadline struct {
	mu                     sync.Mutex
	ctx                    context.Context
	conn                   net.Conn
	networkDeadline        time.Time
	contextDeadline        time.Time
	contextDeadlineApplied bool
	active                 bool
}

func newHandshakeDeadline(ctx context.Context, conn net.Conn, timeout time.Duration) *handshakeDeadline {
	contextDeadline, _ := ctx.Deadline()
	return &handshakeDeadline{
		ctx: ctx, conn: conn, networkDeadline: time.Now().Add(timeout),
		contextDeadline: contextDeadline, active: true,
	}
}

func (d *handshakeDeadline) applyNetworkDeadline() error {
	deadline := d.networkDeadline
	d.contextDeadlineApplied = !d.contextDeadline.IsZero() && !d.contextDeadline.After(deadline)
	if d.contextDeadlineApplied {
		deadline = d.contextDeadline
	}
	return d.conn.SetDeadline(deadline)
}

func (d *handshakeDeadline) wrapHostKeyCallback(callback gossh.HostKeyCallback) gossh.HostKeyCallback {
	if callback == nil {
		return nil
	}
	return func(hostname string, remote net.Addr, key gossh.PublicKey) error {
		remaining, paused, err := d.pause()
		if err != nil {
			return err
		}
		verifyErr := callback(hostname, remote, key)
		if !paused {
			return verifyErr
		}
		return errors.Join(verifyErr, d.resume(remaining))
	}
}

func (d *handshakeDeadline) pause() (time.Duration, bool, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !d.active {
		return 0, false, nil
	}
	if err := d.ctx.Err(); err != nil {
		return 0, false, err
	}
	remaining := time.Until(d.networkDeadline)
	if remaining <= 0 {
		return 0, false, os.ErrDeadlineExceeded
	}
	if err := d.conn.SetDeadline(d.contextDeadline); err != nil {
		return 0, false, fmt.Errorf("pause handshake deadline: %w", err)
	}
	d.contextDeadlineApplied = !d.contextDeadline.IsZero()
	return remaining, true, nil
}

func (d *handshakeDeadline) resume(remaining time.Duration) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !d.active {
		return nil
	}
	d.networkDeadline = time.Now().Add(remaining)
	if err := d.applyNetworkDeadline(); err != nil {
		return fmt.Errorf("resume handshake deadline: %w", err)
	}
	return nil
}

func (d *handshakeDeadline) stop() (time.Time, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.active = false
	return d.contextDeadline, d.contextDeadlineApplied
}
