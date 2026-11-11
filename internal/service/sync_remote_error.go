package service

import (
	"errors"

	backupcrypto "github.com/xuthus5/mssh/internal/crypto"
)

const remoteVaultMismatchMessage = "云端备份使用了其他设备的加密密钥，当前设备无法直接解密。请在“同步状态与配置”中使用“从云端恢复此设备”，并输入备份设备的应用密码。"

func (s *SyncService) remoteArtifactDecodeError(content []byte, decodeErr error) error {
	if !errors.Is(decodeErr, backupcrypto.ErrBackupAuthentication) {
		return decodeErr
	}
	remoteVault, err := peekSyncArtifactVault(content)
	if err != nil {
		return decodeErr
	}
	localVault, err := s.artifactVault()
	if err != nil || localVault == nil {
		return decodeErr
	}
	if *localVault == *remoteVault {
		return decodeErr
	}
	return errors.New(remoteVaultMismatchMessage)
}
