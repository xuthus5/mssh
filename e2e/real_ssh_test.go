package e2e_test

import (
	"context"
	"fmt"
	"net"
	"os"
	"testing"
	"time"

	gossh "golang.org/x/crypto/ssh"

	"github.com/stretchr/testify/require"
)

func TestRealSSH(t *testing.T) {
	host := "127.0.0.1"
	port := 30022

	dialer := net.Dialer{Timeout: 2 * time.Second}
	conn, err := dialer.Dial("tcp", fmt.Sprintf("%s:%d", host, port))
	if err != nil {
		t.Skipf("SSH not available: %v", err)
	}
	conn.Close()

	home, _ := os.UserHomeDir()
	keyBytes, err := os.ReadFile(home + "/.ssh/id_ed25519")
	require.NoError(t, err)
	signer, err := gossh.ParsePrivateKey(keyBytes)
	if err != nil {
		signer, err = gossh.ParsePrivateKeyWithPassphrase(keyBytes, []byte{})
		require.NoError(t, err)
	}

	ctx := context.Background()
	_ = ctx

	nconn, _ := net.DialTimeout("tcp", net.JoinHostPort(host, fmt.Sprint(port)), 5*time.Second)
	config := &gossh.ClientConfig{
		User:            "root",
		Auth:            []gossh.AuthMethod{gossh.PublicKeys(signer)},
		HostKeyCallback: gossh.InsecureIgnoreHostKey(),
		Timeout:         5 * time.Second,
	}

	sshConn, chans, reqs, err := gossh.NewClientConn(nconn, net.JoinHostPort(host, fmt.Sprint(port)), config)
	require.NoError(t, err)
	client := gossh.NewClient(sshConn, chans, reqs)
	defer client.Close()

	session, err := client.NewSession()
	require.NoError(t, err)
	defer session.Close()

	modes := gossh.TerminalModes{gossh.ECHO: 1, gossh.TTY_OP_ISPEED: 14400, gossh.TTY_OP_OSPEED: 14400}
	err = session.RequestPty("xterm-256color", 24, 80, modes)
	require.NoError(t, err)

	stdin, _ := session.StdinPipe()
	stdout, _ := session.StdoutPipe()
	err = session.Shell()
	require.NoError(t, err)
	t.Log("SHELL STARTED")

	done := make(chan struct{})
	output := make(chan []byte, 50)
	go func() {
		defer close(done)
		buf := make([]byte, 4096)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				data := make([]byte, n)
				copy(data, buf[:n])
				t.Logf("OUT %dB: %q", n, string(data[:min(n, 200)]))
				output <- data
			}
			if err != nil {
				t.Logf("read done: %v", err)
				return
			}
		}
	}()

	select {
	case data := <-output:
		t.Logf("FIRST: %d bytes", len(data))
	case <-time.After(5 * time.Second):
		t.Error("no output in 5s")
		return
	}

	stdin.Write([]byte("echo HELLO_SSH\n"))
	t.Log("SENT: echo HELLO_SSH")

	select {
	case data := <-output:
		s := string(data)
		t.Logf("RESPONSE: %q", s[:min(len(s), 200)])
		if !contains(s, "HELLO_SSH") {
			t.Errorf("Missing HELLO_SSH in response")
		}
	case <-time.After(5 * time.Second):
		t.Error("no echo response in 5s")
	}

	session.Close()
	<-done
}

func min(a, b int) int { if a < b { return a }; return b }
func contains(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub { return true }
	}
	return false
}
