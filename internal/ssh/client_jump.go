package ssh

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"strconv"
	"time"

	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/model"
)

// JumpHostConnectOptions 配置经已连接跳板访问目标 SSH 的认证与指纹校验。
type JumpHostConnectOptions struct {
	JumpHost       *ClientWrapper
	Auth           []gossh.AuthMethod
	KnownHostsPath string
	HostKey        HostKeyOptions
	Logger         *slog.Logger
}

// ConnectViaJumpHost 从调用开始接管跳板；连接失败或目标断开时一并回收跳板。
// 目标地址通过 SSH direct-tcpip 请求交给跳板，域名由跳板解析。
func ConnectViaJumpHost(ctx context.Context, target model.Session, options JumpHostConnectOptions) (*ClientWrapper, error) {
	connected := false
	defer func() {
		if !connected {
			_ = options.JumpHost.Close()
		}
	}()
	if ctx == nil {
		return nil, fmt.Errorf("SSH jump connection context is required")
	}
	if options.JumpHost == nil || options.JumpHost.Inner == nil {
		return nil, fmt.Errorf("SSH jump host is unavailable")
	}
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	config, err := jumpTargetClientConfig(target.Username, options)
	if err != nil {
		return nil, err
	}
	address := net.JoinHostPort(target.Host, strconv.Itoa(target.Port))
	conn, err := dialJumpHost(ctx, options.JumpHost, address)
	if err != nil {
		return nil, fmt.Errorf("dial target %s through SSH jump host: %w", address, err)
	}
	sshConn, channels, requests, err := establishSSHConnection(ctx, conn, address, config)
	if err != nil {
		return nil, fmt.Errorf("SSH target handshake through jump host: %w", err)
	}
	wrapper := newClientWrapper(gossh.NewClient(sshConn, channels, requests), conn)
	wrapper.startManagedKeepAlive(time.Duration(target.KeepAlive)*time.Second, options.Logger)
	connected = true
	options.Logger.Info("SSH connection established through jump host", "host", target.Host, "port", target.Port)
	return wrapper, nil
}

func jumpTargetClientConfig(username string, options JumpHostConnectOptions) (*gossh.ClientConfig, error) {
	callback, err := createHostKeyCallback(options.KnownHostsPath, options.HostKey, options.Logger)
	if err != nil {
		return nil, fmt.Errorf("target host key callback: %w", err)
	}
	return &gossh.ClientConfig{
		User: username, Auth: options.Auth, HostKeyCallback: callback, Timeout: sshConnectTimeout,
	}, nil
}

func dialJumpHost(ctx context.Context, jumpHost *ClientWrapper, address string) (net.Conn, error) {
	dialContext, cancel := context.WithTimeout(ctx, sshConnectTimeout)
	defer cancel()
	forwarded, err := jumpHost.Inner.DialContext(dialContext, "tcp", address)
	if err != nil {
		return nil, err
	}
	return newJumpHostTransport(forwarded, jumpHost), nil
}
