package ssh

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/pkg/sftp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"

	"mssh/internal/model"
	"mssh/internal/ssh/testutil"
)

func startSFTPServer(t *testing.T) (string, func()) {
	t.Helper()
	config := &gossh.ServerConfig{
		NoClientAuth: true,
	}
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	signer, err := gossh.NewSignerFromSigner(privateKey)
	require.NoError(t, err)
	config.AddHostKey(signer)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				sconn, chans, reqs, err := gossh.NewServerConn(conn, config)
				if err != nil {
					return
				}
				go gossh.DiscardRequests(reqs)
				for ch := range chans {
					if ch.ChannelType() != "session" {
						_ = ch.Reject(gossh.UnknownChannelType, "unknown channel type")
						continue
					}
					channel, requests, err := ch.Accept()
					if err != nil {
						return
					}
					go func(in <-chan *gossh.Request) {
						for req := range in {
							ok := false
							if req.Type == "subsystem" && len(req.Payload) > 4 && string(req.Payload[4:]) == "sftp" {
								ok = true
							}
							_ = req.Reply(ok, nil)
						}
					}(requests)
					handler := sftp.InMemHandler()
					srv := sftp.NewRequestServer(channel, handler)
					_ = srv.Serve()
					_ = srv.Close()
				}
				_ = sconn.Close()
			}()
		}
	}()

	cleanup := func() { _ = listener.Close() }
	return listener.Addr().String(), cleanup
}

func connectSFTP(t *testing.T, addr string) (cw *ClientWrapper, client *sftp.Client) {
	t.Helper()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test"}
	ctx := context.Background()
	cw, err := Connect(ctx, s, nil)
	require.NoError(t, err)
	client, err = OpenSFTP(cw)
	require.NoError(t, err)
	return cw, client
}

func TestOpenSFTP(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()
	assert.NotNil(t, client)
}

func TestOpenSFTP_ClosedWrapper(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test"}
	ctx := context.Background()
	cw, err := Connect(ctx, s, nil)
	require.NoError(t, err)
	cw.Close()
	_, err = OpenSFTP(cw)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "open sftp")
}

func TestOpenSFTP_NonSFTPServer(t *testing.T) {
	addr, cleanup := testutil.NewMockServer(t)
	defer cleanup()
	s := model.Session{Host: "127.0.0.1", Port: mustParsePort(addr), Username: "test"}
	ctx := context.Background()
	cw, err := Connect(ctx, s, nil)
	require.NoError(t, err)
	defer cw.Close()
	_, err = OpenSFTP(cw)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "open sftp")
}

func TestListDir_EmptyRoot(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	entries, err := ListDir(client, "/")
	require.NoError(t, err)
	assert.NotNil(t, entries)
	assert.Empty(t, entries)
}

func TestListDir_NonExistentPath(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	_, err := ListDir(client, "/nonexistent")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "list dir")
}

func TestListDir_WithFiles(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	f, err := client.Create("/testfile.txt")
	require.NoError(t, err)
	_, _ = f.Write([]byte("hello"))
	_ = f.Close()

	_ = client.Mkdir("/testdir")

	entries, err := ListDir(client, "/")
	require.NoError(t, err)
	assert.GreaterOrEqual(t, len(entries), 2)

	var foundFile, foundDir bool
	for _, e := range entries {
		if e.Name == "testfile.txt" {
			foundFile = true
			assert.False(t, e.IsDir)
			assert.Equal(t, int64(5), e.Size)
			assert.Equal(t, "/testfile.txt", e.Path)
		}
		if e.Name == "testdir" {
			foundDir = true
			assert.True(t, e.IsDir)
			assert.Equal(t, "/testdir", e.Path)
		}
	}
	assert.True(t, foundFile, "expected testfile.txt in listing")
	assert.True(t, foundDir, "expected testdir in listing")
}

func TestListDir_Subdirectory(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	_ = client.Mkdir("/sub")
	f, err := client.Create("/sub/file.txt")
	require.NoError(t, err)
	_, _ = f.Write([]byte("data"))
	_ = f.Close()

	entries, err := ListDir(client, "/sub")
	require.NoError(t, err)
	require.Len(t, entries, 1)
	assert.Equal(t, "file.txt", entries[0].Name)
	assert.Equal(t, "/sub/file.txt", entries[0].Path)
}

func TestUploadFile_Success(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	tmpDir := t.TempDir()
	srcPath := filepath.Join(tmpDir, "test.txt")
	content := []byte("hello world test upload")
	err := os.WriteFile(srcPath, content, 0o600)
	require.NoError(t, err)

	err = UploadFile(client, srcPath, "/uploaded.txt", nil)
	require.NoError(t, err)

	info, err := client.Stat("/uploaded.txt")
	require.NoError(t, err)
	assert.Equal(t, int64(len(content)), info.Size())
}

func TestUploadFile_WithProgress(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	tmpDir := t.TempDir()
	srcPath := filepath.Join(tmpDir, "bigfile.bin")
	content := make([]byte, 100*1024)
	_, _ = rand.Read(content)
	err := os.WriteFile(srcPath, content, 0o600)
	require.NoError(t, err)

	var progressCalls []int64
	err = UploadFile(client, srcPath, "/bigfile.bin", func(transferred, total int64) {
		progressCalls = append(progressCalls, transferred)
	})
	require.NoError(t, err)
	require.NotEmpty(t, progressCalls)
	assert.Equal(t, int64(len(content)), progressCalls[len(progressCalls)-1])

	for i := 1; i < len(progressCalls); i++ {
		assert.Greater(t, progressCalls[i], progressCalls[i-1])
	}
}

func TestUploadFile_LocalFileNotFound(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	err := UploadFile(client, "/nonexistent/local/path", "/remote.txt", nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "open local")
}

func TestUploadFile_CreatesRemoteDirs(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	tmpDir := t.TempDir()
	srcPath := filepath.Join(tmpDir, "test.txt")
	err := os.WriteFile(srcPath, []byte("data"), 0o600)
	require.NoError(t, err)

	err = UploadFile(client, srcPath, "/a/b/c/d/file.txt", nil)
	require.NoError(t, err)

	info, err := client.Stat("/a/b/c/d/file.txt")
	require.NoError(t, err)
	assert.False(t, info.IsDir())
}

func TestDownloadFile_Success(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	content := []byte("download test content for verification")
	f, err := client.Create("/download-test.txt")
	require.NoError(t, err)
	_, err = f.Write(content)
	require.NoError(t, err)
	_ = f.Close()

	tmpDir := t.TempDir()
	dstPath := filepath.Join(tmpDir, "downloaded.txt")

	err = DownloadFile(client, "/download-test.txt", dstPath, nil)
	require.NoError(t, err)

	downloaded, err := os.ReadFile(dstPath)
	require.NoError(t, err)
	assert.Equal(t, content, downloaded)
}

func TestDownloadFile_WithProgress(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	content := make([]byte, 100*1024)
	_, _ = rand.Read(content)
	f, err := client.Create("/download-big.bin")
	require.NoError(t, err)
	_, err = f.Write(content)
	require.NoError(t, err)
	_ = f.Close()

	tmpDir := t.TempDir()
	dstPath := filepath.Join(tmpDir, "downloaded.bin")

	var progressCalls []int64
	err = DownloadFile(client, "/download-big.bin", dstPath, func(transferred, total int64) {
		progressCalls = append(progressCalls, transferred)
	})
	require.NoError(t, err)
	require.NotEmpty(t, progressCalls)
	assert.Equal(t, int64(len(content)), progressCalls[len(progressCalls)-1])
}

func TestDownloadFile_RemoteNotFound(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	tmpDir := t.TempDir()
	dstPath := filepath.Join(tmpDir, "output.txt")

	err := DownloadFile(client, "/nonexistent-remote.txt", dstPath, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "open remote")
}

func TestDownloadFile_CreatesLocalDirs(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	f, err := client.Create("/remote-to-dl.txt")
	require.NoError(t, err)
	_, _ = f.Write([]byte("data"))
	_ = f.Close()

	tmpDir := t.TempDir()
	dstPath := filepath.Join(tmpDir, "newsub", "nested", "file.txt")

	err = DownloadFile(client, "/remote-to-dl.txt", dstPath, nil)
	require.NoError(t, err)

	info, err := os.Stat(dstPath)
	require.NoError(t, err)
	assert.False(t, info.IsDir())
}

func TestRemoveFile(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	f, err := client.Create("/todelete.txt")
	require.NoError(t, err)
	_ = f.Close()

	err = RemoveFile(client, "/todelete.txt")
	require.NoError(t, err)

	_, err = client.Stat("/todelete.txt")
	assert.Error(t, err)
}

func TestRemoveFile_NotFound(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	err := RemoveFile(client, "/nonexistent-file.txt")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "remove")
}

func TestRemoveDir(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	_ = client.Mkdir("/toremove-dir")

	err := RemoveDir(client, "/toremove-dir")
	require.NoError(t, err)

	_, err = client.Stat("/toremove-dir")
	assert.Error(t, err)
}

func TestRemoveDir_NotFound(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	err := RemoveDir(client, "/nonexistent-dir")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "remove dir")
}

func TestMkdir(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	err := Mkdir(client, "/newdir")
	require.NoError(t, err)

	info, err := client.Stat("/newdir")
	require.NoError(t, err)
	assert.True(t, info.IsDir())
}

func TestMkdir_Nested(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	err := Mkdir(client, "/a/b/c")
	require.NoError(t, err)

	info, err := client.Stat("/a/b/c")
	require.NoError(t, err)
	assert.True(t, info.IsDir())
}

func TestRename(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	f, err := client.Create("/oldname.txt")
	require.NoError(t, err)
	_, _ = f.Write([]byte("rename test"))
	_ = f.Close()

	err = Rename(client, "/oldname.txt", "/newname.txt")
	require.NoError(t, err)

	_, err = client.Stat("/oldname.txt")
	assert.Error(t, err)

	info, err := client.Stat("/newname.txt")
	require.NoError(t, err)
	assert.False(t, info.IsDir())
}

func TestRename_SourceNotFound(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	err := Rename(client, "/nonexistent.txt", "/target.txt")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "rename")
}

func TestProgressWriter_NilCallback(t *testing.T) {
	pw := &progressWriter{}

	n, err := pw.Write([]byte("hello"))
	require.NoError(t, err)
	assert.Equal(t, 5, n)
	assert.Equal(t, int64(5), pw.total)
}

func TestMkdirError(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	client.Close()
	defer cw.Close()

	err := Mkdir(client, "/test")
	assert.Error(t, err)
}

func TestUploadFile_CreateRemoteError(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	err := UploadFile(client, "/nonexistent-local-file-for-upload", "/remote.txt", nil)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "open local")
}

func TestDownloadFile_OpenLocalError(t *testing.T) {
	addr, cleanup := startSFTPServer(t)
	defer cleanup()
	cw, client := connectSFTP(t, addr)
	defer cw.Close()
	defer client.Close()

	f, err := client.Create("/remote-for-dl.txt")
	require.NoError(t, err)
	_, _ = f.Write([]byte("data"))
	_ = f.Close()

	err = DownloadFile(client, "/remote-for-dl.txt", "/dev/null/output.txt", nil)
	assert.Error(t, err)
}
