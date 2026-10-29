package ssh

import (
	"fmt"

	"github.com/pkg/sftp"
)

const (
	transferSFTPPacketSize     = 128 * 1024
	transferSFTPRequestThreads = 64
)

func OpenSFTP(cw *ClientWrapper) (*sftp.Client, error) {
	return openSFTP(cw)
}

// OpenTransferSFTP opens an SFTP client tuned for bulk file transfers. Servers
// advertising OpenSSH's limits extension accept read requests larger than the
// conservative 32 KiB protocol default, which is needed to fill the SSH
// flow-control window on high-latency links.
func OpenTransferSFTP(cw *ClientWrapper) (*sftp.Client, error) {
	supportsLargePackets, err := probeSFTPExtensions(cw)
	if err != nil {
		return nil, err
	}
	return openSFTP(cw, transferSFTPOptions(supportsLargePackets)...)
}

func openSFTP(cw *ClientWrapper, options ...sftp.ClientOption) (*sftp.Client, error) {
	client, err := sftp.NewClient(cw.Inner, options...)
	if err != nil {
		return nil, fmt.Errorf("open sftp: %w", err)
	}
	return client, nil
}

func probeSFTPExtensions(cw *ClientWrapper) (bool, error) {
	probe, err := openSFTP(cw)
	if err != nil {
		return false, err
	}
	_, supported := probe.HasExtension("limits@openssh.com")
	if err := probe.Close(); err != nil {
		return false, fmt.Errorf("close sftp capability probe: %w", err)
	}
	return supported, nil
}

func transferSFTPOptions(supportsLargePackets bool) []sftp.ClientOption {
	options := []sftp.ClientOption{sftp.MaxConcurrentRequestsPerFile(transferSFTPRequestThreads)}
	if supportsLargePackets {
		options = append(options, sftp.MaxPacketUnchecked(transferSFTPPacketSize))
	}
	return options
}
