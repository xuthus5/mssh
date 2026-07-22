//go:build darwin || freebsd || openbsd || netbsd || dragonfly

package serial

import "golang.org/x/sys/unix"

func getTermios(fd int) (*unix.Termios, error) {
	return unix.IoctlGetTermios(fd, unix.TIOCGETA)
}

func setTermios(fd int, termios *unix.Termios) error {
	return unix.IoctlSetTermios(fd, unix.TIOCSETA, termios)
}

func disableHardwareFlow(termios *unix.Termios) {
	termios.Cflag &^= unix.CRTSCTS
}

func enableHardwareFlow(termios *unix.Termios) {
	termios.Cflag |= unix.CRTSCTS
}
