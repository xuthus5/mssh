//go:build linux

package serial

import "golang.org/x/sys/unix"

func getTermios(fd int) (*unix.Termios, error) {
	return unix.IoctlGetTermios(fd, unix.TCGETS)
}

func setTermios(fd int, termios *unix.Termios) error {
	return unix.IoctlSetTermios(fd, unix.TCSETS, termios)
}

func disableHardwareFlow(termios *unix.Termios) {
	termios.Cflag &^= unix.CRTSCTS
}

func enableHardwareFlow(termios *unix.Termios) {
	termios.Cflag |= unix.CRTSCTS
}
