package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/crypto/argon2"
)

const (
	VaultFormatVersion = 1
	VaultFileName      = "vault.json"
	vaultKeyLength     = 32
	vaultSaltLength    = 16
	vaultArgonTime     = 3
	vaultArgonMemory   = 64 * 1024
	vaultArgonThreads  = 2
	MinAppPasswordLen  = 12
)

// VaultFile is the on-disk envelope that wraps a random DEK with a password-derived KEK.
type VaultFile struct {
	FormatVersion int    `json:"format_version"`
	Cipher        string `json:"cipher"`
	KDF           string `json:"kdf"`
	ArgonTime     uint32 `json:"argon_time"`
	ArgonMemory   uint32 `json:"argon_memory"`
	ArgonThreads  uint8  `json:"argon_threads"`
	Salt          string `json:"salt"`
	Nonce         string `json:"nonce"`
	WrappedDEK    string `json:"wrapped_dek"`
	UpdatedAt     string `json:"updated_at"`
}

// VaultExport is embedded in encrypted backups so another device can restore the same DEK.
type VaultExport struct {
	VaultFile
}

func VaultPath(dataDir string) string {
	return filepath.Join(dataDir, VaultFileName)
}

func ValidateAppPassword(password string) error {
	if len(password) < MinAppPasswordLen {
		return fmt.Errorf("password must contain at least %d characters", MinAppPasswordLen)
	}
	return nil
}

func CreateVault(password string) (VaultFile, []byte, error) {
	if err := ValidateAppPassword(password); err != nil {
		return VaultFile{}, nil, err
	}
	dek, err := randomBytes(vaultKeyLength)
	if err != nil {
		return VaultFile{}, nil, err
	}
	vault, err := wrapDEK(password, dek)
	if err != nil {
		return VaultFile{}, nil, err
	}
	return vault, dek, nil
}

func UnlockVault(password string, vault VaultFile) ([]byte, error) {
	if err := ValidateAppPassword(password); err != nil {
		return nil, err
	}
	if err := validateVaultFile(vault); err != nil {
		return nil, err
	}
	return unwrapDEK(password, vault)
}

// RotateVaultPassword creates a new DEK wrapped by newPassword. Caller must re-encrypt data with reencrypt.
func RotateVaultPassword(oldPassword, newPassword string, vault VaultFile, reencrypt func(oldDEK, newDEK []byte) error) (VaultFile, []byte, error) {
	oldDEK, err := UnlockVault(oldPassword, vault)
	if err != nil {
		return VaultFile{}, nil, fmt.Errorf("verify current password: %w", err)
	}
	if err := ValidateAppPassword(newPassword); err != nil {
		return VaultFile{}, nil, err
	}
	newDEK, err := randomBytes(vaultKeyLength)
	if err != nil {
		return VaultFile{}, nil, err
	}
	if reencrypt != nil {
		if err := reencrypt(oldDEK, newDEK); err != nil {
			return VaultFile{}, nil, fmt.Errorf("re-encrypt protected data: %w", err)
		}
	}
	next, err := wrapDEK(newPassword, newDEK)
	if err != nil {
		return VaultFile{}, nil, err
	}
	return next, newDEK, nil
}

func LoadVaultFile(path string) (VaultFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return VaultFile{}, err
	}
	var vault VaultFile
	if err := json.Unmarshal(data, &vault); err != nil {
		return VaultFile{}, fmt.Errorf("decode vault: %w", err)
	}
	if err := validateVaultFile(vault); err != nil {
		return VaultFile{}, err
	}
	return vault, nil
}

func SaveVaultFile(path string, vault VaultFile) error {
	if err := validateVaultFile(vault); err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create vault directory: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return fmt.Errorf("secure vault directory: %w", err)
	}
	payload, err := json.MarshalIndent(vault, "", "  ")
	if err != nil {
		return fmt.Errorf("encode vault: %w", err)
	}
	payload = append(payload, '\n')
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		return fmt.Errorf("write vault temp: %w", err)
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("secure vault temp: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("replace vault: %w", err)
	}
	return nil
}

func VaultExists(dataDir string) bool {
	_, err := os.Stat(VaultPath(dataDir))
	return err == nil
}

// InstallVaultFile writes vault metadata without changing the caller's unlocked DEK.
func InstallVaultFile(dataDir string, vault VaultFile) error {
	if err := validateVaultFile(vault); err != nil {
		return err
	}
	return SaveVaultFile(VaultPath(dataDir), vault)
}

func wrapDEK(password string, dek []byte) (VaultFile, error) {
	salt, err := randomBytes(vaultSaltLength)
	if err != nil {
		return VaultFile{}, err
	}
	kek := argon2.IDKey([]byte(password), salt, vaultArgonTime, vaultArgonMemory, vaultArgonThreads, vaultKeyLength)
	block, err := aes.NewCipher(kek)
	if err != nil {
		return VaultFile{}, fmt.Errorf("create vault cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return VaultFile{}, fmt.Errorf("create vault GCM: %w", err)
	}
	nonce, err := randomBytes(aead.NonceSize())
	if err != nil {
		return VaultFile{}, err
	}
	wrapped := aead.Seal(nil, nonce, dek, nil)
	return VaultFile{
		FormatVersion: VaultFormatVersion,
		Cipher:        "AES-256-GCM",
		KDF:           "Argon2id",
		ArgonTime:     vaultArgonTime,
		ArgonMemory:   vaultArgonMemory,
		ArgonThreads:  vaultArgonThreads,
		Salt:          base64.StdEncoding.EncodeToString(salt),
		Nonce:         base64.StdEncoding.EncodeToString(nonce),
		WrappedDEK:    base64.StdEncoding.EncodeToString(wrapped),
		UpdatedAt:     time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func unwrapDEK(password string, vault VaultFile) ([]byte, error) {
	salt, err := base64.StdEncoding.DecodeString(vault.Salt)
	if err != nil {
		return nil, fmt.Errorf("decode vault salt: %w", err)
	}
	nonce, err := base64.StdEncoding.DecodeString(vault.Nonce)
	if err != nil {
		return nil, fmt.Errorf("decode vault nonce: %w", err)
	}
	wrapped, err := base64.StdEncoding.DecodeString(vault.WrappedDEK)
	if err != nil {
		return nil, fmt.Errorf("decode wrapped DEK: %w", err)
	}
	kek := argon2.IDKey([]byte(password), salt, vault.ArgonTime, vault.ArgonMemory, vault.ArgonThreads, vaultKeyLength)
	block, err := aes.NewCipher(kek)
	if err != nil {
		return nil, fmt.Errorf("create vault cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create vault GCM: %w", err)
	}
	if len(nonce) != aead.NonceSize() {
		return nil, errors.New("invalid vault nonce length")
	}
	dek, err := aead.Open(nil, nonce, wrapped, nil)
	if err != nil {
		return nil, errors.New("invalid application password")
	}
	if len(dek) != vaultKeyLength {
		return nil, errors.New("invalid vault DEK length")
	}
	return dek, nil
}

func validateVaultFile(vault VaultFile) error {
	if vault.FormatVersion != VaultFormatVersion {
		return fmt.Errorf("unsupported vault format %d", vault.FormatVersion)
	}
	if vault.Cipher != "AES-256-GCM" || vault.KDF != "Argon2id" {
		return errors.New("unsupported vault encryption parameters")
	}
	if vault.Salt == "" || vault.Nonce == "" || vault.WrappedDEK == "" {
		return errors.New("vault file is incomplete")
	}
	if vault.ArgonTime == 0 || vault.ArgonMemory == 0 || vault.ArgonThreads == 0 {
		return errors.New("vault KDF parameters are invalid")
	}
	return nil
}

// SyncSecretFromDEK derives a stable backup secret from the DEK (not the password).
// Cross-device restore must install the same vault/DEK for sync decrypt to succeed.
func SyncSecretFromDEK(dek []byte) string {
	return base64.RawStdEncoding.EncodeToString(dek)
}
