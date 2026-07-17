//go:build e2e

package e2e_test

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type sshdFixture struct {
	address       string
	privateKey    string
	hostPublicKey []byte
}

func startSSHD(t *testing.T) sshdFixture {
	t.Helper()
	sshdPath := requireCommand(t, "sshd")
	requireCommand(t, "ssh-keygen")
	directory := t.TempDir()
	hostKey := filepath.Join(directory, "host_key")
	clientKey := filepath.Join(directory, "client_key")
	runCommand(t, "ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", hostKey)
	runCommand(t, "ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", clientKey)
	publicKey, err := os.ReadFile(clientKey + ".pub")
	require.NoError(t, err)
	authorizedKeys := filepath.Join(directory, "authorized_keys")
	require.NoError(t, os.WriteFile(authorizedKeys, publicKey, 0o600))
	port := reservePort(t)
	config := filepath.Join(directory, "sshd_config")
	content := fmt.Sprintf("Port %d\nListenAddress 127.0.0.1\nHostKey %s\nPidFile %s\nAuthorizedKeysFile %s\nStrictModes no\nPermitRootLogin yes\nPubkeyAuthentication yes\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nPrintMotd no\nLogLevel ERROR\nSubsystem sftp internal-sftp\n", port, hostKey, filepath.Join(directory, "sshd.pid"), authorizedKeys)
	require.NoError(t, os.WriteFile(config, []byte(content), 0o600))
	require.NoError(t, os.MkdirAll("/run/sshd", 0o755))
	command := exec.Command(sshdPath, "-D", "-e", "-f", config)
	command.Stdout, command.Stderr = os.Stdout, os.Stderr
	require.NoError(t, command.Start())
	t.Cleanup(func() { _ = command.Process.Kill(); _, _ = command.Process.Wait() })
	address := fmt.Sprintf("127.0.0.1:%d", port)
	waitForPort(t, address)
	hostPublicKey, err := os.ReadFile(hostKey + ".pub")
	require.NoError(t, err)
	return sshdFixture{address: address, privateKey: clientKey, hostPublicKey: hostPublicKey}
}

func requireCommand(t *testing.T, name string) string {
	t.Helper()
	path, err := exec.LookPath(name)
	if err != nil {
		t.Skipf("%s is required: %v", name, err)
	}
	return path
}

func runCommand(t *testing.T, name string, arguments ...string) {
	t.Helper()
	command := exec.Command(name, arguments...)
	output, err := command.CombinedOutput()
	require.NoError(t, err, string(output))
}

func reservePort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	port := listener.Addr().(*net.TCPAddr).Port
	require.NoError(t, listener.Close())
	return port
}

func waitForPort(t *testing.T, address string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		connection, err := net.DialTimeout("tcp", address, 100*time.Millisecond)
		if err == nil {
			_ = connection.Close()
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("sshd did not listen on %s", address)
}
