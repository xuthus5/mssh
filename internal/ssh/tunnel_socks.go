package ssh

import (
	"context"
	"io"
	"net"
	"strconv"
	"strings"
	"time"
)

const (
	socks5HandshakeTimeout       = 10 * time.Second
	socks5Version                = 0x05
	socks5NoAuthentication       = 0x00
	socks5NoAcceptableMethods    = 0xff
	socks5ConnectCommand         = 0x01
	socks5Succeeded              = 0x00
	socks5GeneralFailure         = 0x01
	socks5ConnectionRefused      = 0x05
	socks5CommandNotSupported    = 0x07
	socks5AddressTypeUnsupported = 0x08
	socks5IPv4Address            = 0x01
	socks5DomainAddress          = 0x03
	socks5IPv6Address            = 0x04
)

func handleSOCKS5(client *ClientWrapper, connection net.Conn) {
	handleSOCKS5Context(context.Background(), client, connection)
}

func handleSOCKS5Context(ctx context.Context, client *ClientWrapper, connection net.Conn) {
	defer func() { _ = connection.Close() }()
	if err := connection.SetDeadline(time.Now().Add(socks5HandshakeTimeout)); err != nil {
		return
	}
	destination, ok := readSOCKS5Destination(connection)
	if !ok {
		return
	}
	if err := connection.SetDeadline(time.Time{}); err != nil {
		return
	}
	if client == nil || client.Inner == nil {
		_ = writeSOCKS5Reply(connection, socks5GeneralFailure)
		return
	}
	remote, err := dialTunnelTargetContext(ctx, client.Inner, destination, tunnelConnectTimeout)
	if err != nil {
		_ = writeSOCKS5Reply(connection, socks5ConnectionRefused)
		return
	}
	defer func() { _ = remote.Close() }()
	if err := writeSOCKS5Reply(connection, socks5Succeeded); err != nil {
		return
	}
	copyBidirectionalContext(ctx, connection, remote)
}

func readSOCKS5Destination(connection net.Conn) (string, bool) {
	if !negotiateSOCKS5Authentication(connection) {
		return "", false
	}
	request := make([]byte, 4)
	if _, err := io.ReadFull(connection, request); err != nil || request[0] != socks5Version {
		return "", false
	}
	if request[1] != socks5ConnectCommand {
		_ = writeSOCKS5Reply(connection, socks5CommandNotSupported)
		return "", false
	}
	if request[2] != 0 {
		_ = writeSOCKS5Reply(connection, socks5GeneralFailure)
		return "", false
	}
	return readSOCKS5Address(connection, request[3])
}

func negotiateSOCKS5Authentication(connection net.Conn) bool {
	greeting := make([]byte, 2)
	if _, err := io.ReadFull(connection, greeting); err != nil || greeting[0] != socks5Version {
		return false
	}
	methods := make([]byte, int(greeting[1]))
	if len(methods) == 0 {
		_ = writeSOCKS5Selection(connection, socks5NoAcceptableMethods)
		return false
	}
	if _, err := io.ReadFull(connection, methods); err != nil {
		return false
	}
	if !containsSOCKS5Method(methods, socks5NoAuthentication) {
		_ = writeSOCKS5Selection(connection, socks5NoAcceptableMethods)
		return false
	}
	return writeSOCKS5Selection(connection, socks5NoAuthentication) == nil
}

func readSOCKS5Address(connection net.Conn, addressType byte) (string, bool) {
	switch addressType {
	case socks5IPv4Address:
		content := make([]byte, net.IPv4len+2)
		if _, err := io.ReadFull(connection, content); err != nil {
			return "", false
		}
		return validatedSOCKS5Address(connection, net.IP(content[:net.IPv4len]).String(), content[net.IPv4len:])
	case socks5DomainAddress:
		return readSOCKS5DomainAddress(connection)
	case socks5IPv6Address:
		content := make([]byte, net.IPv6len+2)
		if _, err := io.ReadFull(connection, content); err != nil {
			return "", false
		}
		return validatedSOCKS5Address(connection, net.IP(content[:net.IPv6len]).String(), content[net.IPv6len:])
	default:
		_ = writeSOCKS5Reply(connection, socks5AddressTypeUnsupported)
		return "", false
	}
}

func readSOCKS5DomainAddress(connection net.Conn) (string, bool) {
	length := make([]byte, 1)
	if _, err := io.ReadFull(connection, length); err != nil || length[0] == 0 {
		_ = writeSOCKS5Reply(connection, socks5GeneralFailure)
		return "", false
	}
	content := make([]byte, int(length[0])+2)
	if _, err := io.ReadFull(connection, content); err != nil {
		return "", false
	}
	host := string(content[:len(content)-2])
	if strings.ContainsRune(host, 0) {
		_ = writeSOCKS5Reply(connection, socks5GeneralFailure)
		return "", false
	}
	return validatedSOCKS5Address(connection, host, content[len(content)-2:])
}

func validatedSOCKS5Address(connection net.Conn, host string, portBytes []byte) (string, bool) {
	port := int(portBytes[0])<<8 | int(portBytes[1])
	if strings.TrimSpace(host) == "" || port == 0 {
		_ = writeSOCKS5Reply(connection, socks5GeneralFailure)
		return "", false
	}
	return net.JoinHostPort(host, strconv.Itoa(port)), true
}

func containsSOCKS5Method(methods []byte, wanted byte) bool {
	for _, method := range methods {
		if method == wanted {
			return true
		}
	}
	return false
}

func writeSOCKS5Selection(connection net.Conn, method byte) error {
	_, err := connection.Write([]byte{socks5Version, method})
	return err
}

func writeSOCKS5Reply(connection net.Conn, code byte) error {
	_, err := connection.Write([]byte{socks5Version, code, 0x00, socks5IPv4Address, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00})
	return err
}
