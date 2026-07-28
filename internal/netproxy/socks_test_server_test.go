package netproxy

import (
	"encoding/binary"
	"io"
	"net"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

const socksTestTimeout = 5 * time.Second

type fakeSOCKSServer struct {
	listener      net.Listener
	username      string
	password      string
	requests      chan string
	auth          chan bool
	connectionsMu sync.Mutex
	connections   map[net.Conn]struct{}
	workers       sync.WaitGroup
}

func newFakeSOCKSServer(t *testing.T, username, password string) *fakeSOCKSServer {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	server := &fakeSOCKSServer{
		listener: listener, username: username, password: password,
		requests: make(chan string, 8), auth: make(chan bool, 8),
		connections: make(map[net.Conn]struct{}),
	}
	server.workers.Add(1)
	go server.acceptLoop()
	t.Cleanup(server.Close)
	return server
}

func (s *fakeSOCKSServer) URL(scheme string) string {
	return scheme + "://" + s.listener.Addr().String()
}

func (s *fakeSOCKSServer) Close() {
	if s == nil {
		return
	}
	_ = s.listener.Close()
	s.connectionsMu.Lock()
	for connection := range s.connections {
		_ = connection.Close()
	}
	s.connectionsMu.Unlock()
	s.workers.Wait()
}

func (s *fakeSOCKSServer) acceptLoop() {
	defer s.workers.Done()
	for {
		connection, err := s.listener.Accept()
		if err != nil {
			return
		}
		s.track(connection)
		s.workers.Add(1)
		go func() {
			defer s.workers.Done()
			defer s.untrack(connection)
			s.handle(connection)
		}()
	}
}

func (s *fakeSOCKSServer) track(connection net.Conn) {
	s.connectionsMu.Lock()
	s.connections[connection] = struct{}{}
	s.connectionsMu.Unlock()
}

func (s *fakeSOCKSServer) untrack(connection net.Conn) {
	s.connectionsMu.Lock()
	delete(s.connections, connection)
	s.connectionsMu.Unlock()
	_ = connection.Close()
}

func (s *fakeSOCKSServer) handle(connection net.Conn) {
	_ = connection.SetDeadline(time.Now().Add(socksTestTimeout))
	methodHeader := make([]byte, 2)
	if _, err := io.ReadFull(connection, methodHeader); err != nil || methodHeader[0] != 5 {
		return
	}
	methods := make([]byte, int(methodHeader[1]))
	if _, err := io.ReadFull(connection, methods); err != nil {
		return
	}
	selected := byte(0)
	if s.username != "" || s.password != "" {
		selected = 2
	}
	if !containsByte(methods, selected) || !writeBytes(connection, []byte{5, selected}) {
		return
	}
	if selected == 2 && !s.authenticate(connection) {
		return
	}
	request, ok := readSOCKSRequest(connection)
	if !ok {
		return
	}
	s.requests <- request
	target, err := net.DialTimeout("tcp", request, socksTestTimeout)
	if err != nil {
		_ = writeBytes(connection, []byte{5, 5, 0, 1, 0, 0, 0, 0, 0, 0})
		return
	}
	s.track(target)
	defer s.untrack(target)
	if !writeBytes(connection, []byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0}) {
		return
	}
	_ = connection.SetDeadline(time.Time{})
	_ = target.SetDeadline(time.Time{})
	var relay sync.WaitGroup
	relay.Add(2)
	go copyAndClose(&relay, target, connection)
	go copyAndClose(&relay, connection, target)
	relay.Wait()
}

func (s *fakeSOCKSServer) authenticate(connection net.Conn) bool {
	header := make([]byte, 2)
	if _, err := io.ReadFull(connection, header); err != nil || header[0] != 1 {
		return false
	}
	username := make([]byte, int(header[1]))
	if _, err := io.ReadFull(connection, username); err != nil {
		return false
	}
	passwordLength := []byte{0}
	if _, err := io.ReadFull(connection, passwordLength); err != nil {
		return false
	}
	password := make([]byte, int(passwordLength[0]))
	if _, err := io.ReadFull(connection, password); err != nil {
		return false
	}
	ok := string(username) == s.username && string(password) == s.password
	s.auth <- ok
	if ok {
		return writeBytes(connection, []byte{1, 0})
	}
	return writeBytes(connection, []byte{1, 1})
}

func readSOCKSRequest(connection net.Conn) (string, bool) {
	header := make([]byte, 4)
	if _, err := io.ReadFull(connection, header); err != nil || header[0] != 5 || header[1] != 1 {
		return "", false
	}
	host, ok := readSOCKSHost(connection, header[3])
	if !ok {
		return "", false
	}
	port := make([]byte, 2)
	if _, err := io.ReadFull(connection, port); err != nil {
		return "", false
	}
	return net.JoinHostPort(host, strconv.Itoa(int(binary.BigEndian.Uint16(port)))), true
}

func readSOCKSHost(connection net.Conn, addressType byte) (string, bool) {
	switch addressType {
	case 1:
		return readSOCKSIP(connection, net.IPv4len)
	case 3:
		length := []byte{0}
		if _, err := io.ReadFull(connection, length); err != nil {
			return "", false
		}
		address := make([]byte, int(length[0]))
		_, err := io.ReadFull(connection, address)
		return string(address), err == nil
	case 4:
		return readSOCKSIP(connection, net.IPv6len)
	default:
		return "", false
	}
}

func readSOCKSIP(connection net.Conn, size int) (string, bool) {
	address := make([]byte, size)
	if _, err := io.ReadFull(connection, address); err != nil {
		return "", false
	}
	return net.IP(address).String(), true
}

func copyAndClose(waitGroup *sync.WaitGroup, destination net.Conn, source net.Conn) {
	defer waitGroup.Done()
	_, _ = io.Copy(destination, source)
	_ = destination.Close()
}

func writeBytes(connection net.Conn, bytes []byte) bool {
	_, err := connection.Write(bytes)
	return err == nil
}

func containsByte(bytes []byte, wanted byte) bool {
	for _, value := range bytes {
		if value == wanted {
			return true
		}
	}
	return false
}
