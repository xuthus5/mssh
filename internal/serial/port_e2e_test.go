//go:build e2e && linux

package serial

import (
	"bytes"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/creack/pty"
	"github.com/stretchr/testify/require"
	goserial "go.bug.st/serial"
	"golang.org/x/sys/unix"

	"github.com/xuthus5/mssh/internal/model"
)

func TestSerialPTYIntegration(t *testing.T) {
	master, tty, err := pty.Open()
	require.NoError(t, err)
	t.Cleanup(func() { _ = master.Close() })
	t.Cleanup(func() { _ = tty.Close() })
	require.NoError(t, configurePTY(tty))

	originalOpen := openSerialPort
	t.Cleanup(func() { openSerialPort = originalOpen })
	openSerialPort = func(_ string, _ *goserial.Mode) (goserial.Port, error) {
		return &ptyPort{file: tty, peer: master, handle: int(tty.Fd())}, nil
	}

	session, err := OpenPort(model.SerialPort{
		Device:      tty.Name(),
		BaudRate:    115200,
		DataBits:    8,
		FlowControl: "none",
		LineEnding:  model.SerialLineEndingLF,
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = session.Close() })

	dataCh := make(chan []byte, 4)
	session.SetReadCallback(func(data []byte) {
		copyOfData := append([]byte(nil), data...)
		dataCh <- copyOfData
	})
	session.Start()

	_, err = session.Write([]byte("host-to-device\n"))
	require.NoError(t, err)
	readPTYUntil(t, master, []byte("host-to-device\n"))

	_, err = master.Write([]byte("device-to-host\n"))
	require.NoError(t, err)
	receiveUntil(t, dataCh, []byte("device-to-host\n"))
	require.NoError(t, session.Close())
}

func configurePTY(file *os.File) error {
	termios, err := unix.IoctlGetTermios(int(file.Fd()), unix.TCGETS)
	if err != nil {
		return err
	}
	termios.Iflag &^= unix.IGNBRK | unix.BRKINT | unix.PARMRK | unix.ISTRIP | unix.INLCR | unix.IGNCR | unix.ICRNL | unix.IXON
	termios.Oflag &^= unix.OPOST
	termios.Lflag &^= unix.ECHO | unix.ECHONL | unix.ICANON | unix.ISIG | unix.IEXTEN
	termios.Cflag |= unix.CREAD | unix.CLOCAL
	termios.Cc[unix.VMIN] = 1
	termios.Cc[unix.VTIME] = 0
	if err := unix.IoctlSetTermios(int(file.Fd()), unix.TCSETS, termios); err != nil {
		return err
	}
	return nil
}

func readPTYUntil(t *testing.T, file *os.File, marker []byte) []byte {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	var data []byte
	for !bytes.Contains(data, marker) {
		require.NoError(t, file.SetReadDeadline(deadline))
		chunk := make([]byte, 256)
		n, err := file.Read(chunk)
		if n > 0 {
			data = append(data, chunk[:n]...)
		}
		require.NoError(t, err)
	}
	return data
}

func receiveUntil(t *testing.T, dataCh <-chan []byte, marker []byte) []byte {
	t.Helper()
	deadline := time.NewTimer(2 * time.Second)
	defer deadline.Stop()
	var data []byte
	for !bytes.Contains(data, marker) {
		select {
		case chunk := <-dataCh:
			data = append(data, chunk...)
		case <-deadline.C:
			t.Fatalf("did not receive %q", marker)
		}
	}
	return data
}

type ptyPort struct {
	file      *os.File
	peer      *os.File
	handle    int
	closeOnce sync.Once
	closeErr  error
}

func (p *ptyPort) SetMode(*goserial.Mode) error { return nil }

func (p *ptyPort) Read(data []byte) (int, error) { return p.file.Read(data) }

func (p *ptyPort) Write(data []byte) (int, error) { return p.file.Write(data) }

func (p *ptyPort) Drain() error { return nil }

func (p *ptyPort) ResetInputBuffer() error { return nil }

func (p *ptyPort) ResetOutputBuffer() error { return nil }

func (p *ptyPort) SetDTR(bool) error { return nil }

func (p *ptyPort) SetRTS(bool) error { return nil }

func (p *ptyPort) GetModemStatusBits() (*goserial.ModemStatusBits, error) {
	return &goserial.ModemStatusBits{}, nil
}

func (p *ptyPort) SetReadTimeout(time.Duration) error { return nil }

func (p *ptyPort) Close() error {
	p.closeOnce.Do(func() {
		peerErr := p.peer.Close()
		fileErr := p.file.Close()
		p.closeErr = errors.Join(peerErr, fileErr)
	})
	return p.closeErr
}

func (p *ptyPort) Break(time.Duration) error { return nil }

var _ goserial.Port = (*ptyPort)(nil)
