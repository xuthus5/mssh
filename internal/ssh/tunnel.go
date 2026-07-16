package ssh

import (
	"fmt"
	"io"
	"net"
	"strconv"
	"sync"

	"github.com/xuthus5/mssh/internal/model"
)

type ForwardConfig struct {
	Type       model.TunnelType
	LocalHost  string
	LocalPort  int
	RemoteHost string
	RemotePort int
}

func StartForward(cw *ClientWrapper, cfg ForwardConfig) (interface{}, func() error, error) {
	switch cfg.Type {
	case model.TunnelLocal:
		localAddr := net.JoinHostPort(cfg.LocalHost, strconv.Itoa(cfg.LocalPort))
		remoteAddr := net.JoinHostPort(cfg.RemoteHost, strconv.Itoa(cfg.RemotePort))
		ln, err := StartLocalForward(cw, localAddr, remoteAddr)
		if err != nil {
			return nil, nil, err
		}
		return ln, ln.Close, nil
	case model.TunnelRemote:
		remoteAddr := net.JoinHostPort(cfg.RemoteHost, strconv.Itoa(cfg.RemotePort))
		localAddr := net.JoinHostPort(cfg.LocalHost, strconv.Itoa(cfg.LocalPort))
		ln, err := StartRemoteForward(cw, remoteAddr, localAddr)
		if err != nil {
			return nil, nil, err
		}
		return ln, ln.Close, nil
	case model.TunnelDynamic:
		localAddr := net.JoinHostPort(cfg.LocalHost, strconv.Itoa(cfg.LocalPort))
		ln, err := StartDynamicForward(cw, localAddr)
		if err != nil {
			return nil, nil, err
		}
		return ln, ln.Close, nil
	default:
		return nil, nil, fmt.Errorf("unknown tunnel type: %s", cfg.Type)
	}
}

func StartLocalForward(cw *ClientWrapper, localAddr, remoteAddr string) (net.Listener, error) {
	ln, err := net.Listen("tcp", localAddr)
	if err != nil {
		return nil, fmt.Errorf("local forward listen: %w", err)
	}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				remote, err := cw.Inner.Dial("tcp", remoteAddr)
				if err != nil {
					return
				}
				copyBidirectional(conn, remote)
			}()
		}
	}()
	return ln, nil
}

func StartRemoteForward(cw *ClientWrapper, remoteAddr, localAddr string) (net.Listener, error) {
	ln, err := cw.Inner.Listen("tcp", remoteAddr)
	if err != nil {
		return nil, fmt.Errorf("remote forward listen: %w", err)
	}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				local, err := net.Dial("tcp", localAddr)
				if err != nil {
					return
				}
				copyBidirectional(conn, local)
			}()
		}
	}()
	return ln, nil
}

func StartDynamicForward(cw *ClientWrapper, localAddr string) (net.Listener, error) {
	ln, err := net.Listen("tcp", localAddr)
	if err != nil {
		return nil, fmt.Errorf("dynamic forward listen: %w", err)
	}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go handleSOCKS5(cw, conn)
		}
	}()
	return ln, nil
}

func copyBidirectional(a, b net.Conn) {
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		defer b.Close()
		_, _ = io.Copy(b, a)
	}()
	go func() {
		defer wg.Done()
		defer a.Close()
		_, _ = io.Copy(a, b)
	}()
	wg.Wait()
}

func handleSOCKS5(cw *ClientWrapper, conn net.Conn) {
	defer conn.Close()

	buf := make([]byte, 263)

	n, err := io.ReadFull(conn, buf[:2])
	if err != nil || n < 2 || buf[0] != 0x05 {
		return
	}
	nm := int(buf[1])
	_, _ = io.ReadFull(conn, buf[:nm])
	_, err = conn.Write([]byte{0x05, 0x00})
	if err != nil {
		return
	}

	n, err = io.ReadFull(conn, buf[:4])
	if err != nil || n < 4 || buf[0] != 0x05 || buf[1] != 0x01 {
		return
	}

	var dest string
	switch buf[3] {
	case 0x01:
		_, err = io.ReadFull(conn, buf[:4+2])
		if err != nil {
			return
		}
		dest = fmt.Sprintf("%d.%d.%d.%d:%d", buf[0], buf[1], buf[2], buf[3], int(buf[4])<<8|int(buf[5]))
	case 0x03:
		_, err = io.ReadFull(conn, buf[:1])
		if err != nil {
			return
		}
		domainLen := int(buf[0])
		_, err = io.ReadFull(conn, buf[:domainLen+2])
		if err != nil {
			return
		}
		dest = fmt.Sprintf("%s:%d", string(buf[:domainLen]), int(buf[domainLen])<<8|int(buf[domainLen+1]))
	case 0x04:
		_, err = io.ReadFull(conn, buf[:16+2])
		if err != nil {
			return
		}
		ip := net.IP(buf[:16])
		dest = fmt.Sprintf("[%s]:%d", ip.String(), int(buf[16])<<8|int(buf[17]))
	default:
		_, _ = conn.Write([]byte{0x05, 0x08, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00})
		return
	}

	remote, err := cw.Inner.Dial("tcp", dest)
	if err != nil {
		_, _ = conn.Write([]byte{0x05, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00})
		return
	}
	defer remote.Close()

	_, err = conn.Write([]byte{0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00})
	if err != nil {
		return
	}

	copyBidirectional(conn, remote)
}
