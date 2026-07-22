//go:build linux

package serial

import (
	"os"
	"testing"
	"unsafe"

	"github.com/stretchr/testify/require"
	"golang.org/x/sys/unix"
)

func TestTermiosFlowFlagsRoundTrip(t *testing.T) {
	master, slave, err := openPTYPair()
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = master.Close()
		_ = slave.Close()
	})

	fd := int(slave.Fd())
	termios, err := getTermios(fd)
	require.NoError(t, err)
	disableHardwareFlow(termios)
	termios.Iflag &^= unix.IXON | unix.IXOFF | unix.IXANY
	require.NoError(t, setTermios(fd, termios))

	termios, err = getTermios(fd)
	require.NoError(t, err)
	enableHardwareFlow(termios)
	require.NoError(t, setTermios(fd, termios))
	termios, err = getTermios(fd)
	require.NoError(t, err)
	require.NotZero(t, termios.Cflag&unix.CRTSCTS)

	termios, err = getTermios(fd)
	require.NoError(t, err)
	disableHardwareFlow(termios)
	termios.Iflag |= unix.IXON | unix.IXOFF
	require.NoError(t, setTermios(fd, termios))
	termios, err = getTermios(fd)
	require.NoError(t, err)
	require.Zero(t, termios.Cflag&unix.CRTSCTS)
	require.NotZero(t, termios.Iflag&(unix.IXON|unix.IXOFF))
}

func openPTYPair() (*os.File, *os.File, error) {
	masterFD, err := unix.Open("/dev/ptmx", unix.O_RDWR|unix.O_NOCTTY|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, nil, err
	}
	// unlockpt
	unlock := 0
	if _, _, errno := unix.Syscall(unix.SYS_IOCTL, uintptr(masterFD), unix.TIOCSPTLCK, uintptr(unsafe.Pointer(&unlock))); errno != 0 {
		_ = unix.Close(masterFD)
		return nil, nil, errno
	}
	// ptsname via TIOCGPTN
	var n uint32
	if _, _, errno := unix.Syscall(unix.SYS_IOCTL, uintptr(masterFD), unix.TIOCGPTN, uintptr(unsafe.Pointer(&n))); errno != 0 {
		_ = unix.Close(masterFD)
		return nil, nil, errno
	}
	name := "/dev/pts/" + itoa(int(n))
	slaveFD, err := unix.Open(name, unix.O_RDWR|unix.O_NOCTTY|unix.O_CLOEXEC, 0)
	if err != nil {
		_ = unix.Close(masterFD)
		return nil, nil, err
	}
	return os.NewFile(uintptr(masterFD), "ptmx"), os.NewFile(uintptr(slaveFD), name), nil
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	return string(buf[i:])
}
