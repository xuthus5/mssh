package testutil_test

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/ssh/testutil"
)

func TestMockServerAcceptsPTYAndShell(t *testing.T) {
	address, stop := testutil.NewMockServer(t)
	t.Cleanup(stop)
	client := dialMockServer(t, address)
	defer func() { require.NoError(t, client.Close()) }()
	session, err := client.NewSession()
	require.NoError(t, err)
	defer func() { require.NoError(t, session.Close()) }()
	require.NoError(t, session.RequestPty("xterm", 24, 80, gossh.TerminalModes{}))
	require.NoError(t, session.Shell())
}

func TestMockServerRejectsPTY(t *testing.T) {
	address, stop := testutil.NewMockServerRejectPty(t)
	t.Cleanup(stop)
	client := dialMockServer(t, address)
	defer func() { require.NoError(t, client.Close()) }()
	session, err := client.NewSession()
	require.NoError(t, err)
	defer func() { require.NoError(t, session.Close()) }()
	assert.Error(t, session.RequestPty("xterm", 24, 80, gossh.TerminalModes{}))
}

func TestMockServerRejectsShell(t *testing.T) {
	address, stop := testutil.NewMockServerRejectShell(t)
	t.Cleanup(stop)
	client := dialMockServer(t, address)
	defer func() { require.NoError(t, client.Close()) }()
	session, err := client.NewSession()
	require.NoError(t, err)
	defer func() { require.NoError(t, session.Close()) }()
	require.NoError(t, session.RequestPty("xterm", 24, 80, gossh.TerminalModes{}))
	assert.Error(t, session.Shell())
}

func TestMockServerAutoLogoutVariants(t *testing.T) {
	for _, testCase := range []struct {
		name  string
		start func(*testing.T) (string, func())
	}{
		{name: "delayed", start: testutil.NewMockServerAutoLogout},
		{name: "immediate", start: testutil.NewMockServerImmediateLogout},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			address, stop := testCase.start(t)
			t.Cleanup(stop)
			client := dialMockServer(t, address)
			defer func() { require.NoError(t, client.Close()) }()
			session, err := client.NewSession()
			require.NoError(t, err)
			var output bytes.Buffer
			session.Stdout = &output
			require.NoError(t, session.RequestPty("xterm", 24, 80, gossh.TerminalModes{}))
			require.NoError(t, session.Shell())
			assert.Error(t, session.Wait())
			assert.Contains(t, output.String(), "auto-logout")
		})
	}
}

func dialMockServer(t *testing.T, address string) *gossh.Client {
	t.Helper()
	client, err := gossh.Dial("tcp", address, &gossh.ClientConfig{
		User:            "test",
		HostKeyCallback: gossh.InsecureIgnoreHostKey(), //nolint:gosec // 测试服务器使用临时主机密钥。
	})
	require.NoError(t, err)
	return client
}
