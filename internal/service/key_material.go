package service

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/fsutil"
	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const (
	maxPrivateKeyFileSize   = 1024 * 1024
	maxStoredPrivateKeySize = 2 * maxPrivateKeyFileSize
	maxPublicKeyInputBytes  = 64 * 1024
)

func (k *KeyService) GetMaterial(id int64) (*model.SSHKeyMaterial, error) {
	finish, err := k.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	if id <= 0 {
		return nil, fmt.Errorf("invalid key id")
	}
	outcome := "failed"
	defer func() {
		recordAudit(k.db, k.logger, model.AuditEvent{Action: "key_view", TargetType: "key", TargetID: fmt.Sprint(id), Summary: "查看 SSH 密钥材料", Outcome: outcome})
	}()
	var material *model.SSHKeyMaterial
	err = withCryptoOperation(k.crypto, func() error {
		key, loadErr := store.GetKey(k.db, id)
		if loadErr != nil {
			return fmt.Errorf("get key material: %w", loadErr)
		}
		if requireErr := k.requireCrypto(); requireErr != nil {
			return fmt.Errorf("get key material: %w", requireErr)
		}
		if len(key.PrivateKey) > maxStoredPrivateKeySize {
			return fmt.Errorf("get key material: encrypted private key exceeds %d bytes", maxStoredPrivateKeySize)
		}
		privateKey, decryptErr := k.crypto.Decrypt([]byte(key.PrivateKey))
		if decryptErr != nil {
			return fmt.Errorf("get key material: decrypt private key: %w", decryptErr)
		}
		if len(privateKey) > maxPrivateKeyFileSize {
			clear(privateKey)
			return fmt.Errorf("get key material: private key exceeds %d bytes", maxPrivateKeyFileSize)
		}
		material = keyMaterial(key, strings.Clone(string(privateKey)))
		clear(privateKey)
		return nil
	})
	if err != nil {
		return nil, err
	}
	outcome = "success"
	return material, nil
}

func (k *KeyService) Update(input model.SSHKeyUpdateInput) (*model.SSHKeyMaterial, error) {
	finish, err := k.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	if input.ID <= 0 {
		return nil, fmt.Errorf("invalid key id")
	}
	if err := validatePrivateKeyInput(input.PrivateKey); err != nil {
		return nil, fmt.Errorf("update key: %w", err)
	}
	name, err := normalizedKeyName(input.Name)
	if err != nil {
		return nil, fmt.Errorf("update key: %w", err)
	}
	keyType, derivedPublic, err := k.extractPublicKeyWithType([]byte(input.PrivateKey))
	if err != nil {
		return nil, fmt.Errorf("update key: %w", err)
	}
	publicKey, err := matchingPublicKey(input.PublicKey, derivedPublic)
	if err != nil {
		return nil, fmt.Errorf("update key: %w", err)
	}
	var material *model.SSHKeyMaterial
	err = withCryptoOperation(k.crypto, func() error {
		existing, loadErr := store.GetKey(k.db, input.ID)
		if loadErr != nil {
			return fmt.Errorf("update key: %w", loadErr)
		}
		if requireErr := k.requireCrypto(); requireErr != nil {
			return fmt.Errorf("update key: %w", requireErr)
		}
		privateKey := []byte(input.PrivateKey)
		defer clear(privateKey)
		encrypted, encryptErr := k.encryptPrivateKey(privateKey)
		if encryptErr != nil {
			return fmt.Errorf("update key: %w", encryptErr)
		}
		defer clear(encrypted)
		existing.Name, existing.Type = name, keyType
		existing.PrivateKey, existing.PublicKey = strings.Clone(string(encrypted)), publicKey
		if updateErr := store.UpdateKey(k.db, *existing); updateErr != nil {
			return fmt.Errorf("update key: %w", updateErr)
		}
		material = keyMaterial(existing, input.PrivateKey)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return material, nil
}

func (k *KeyService) SelectImportFile() (*model.SSHKeyImportFile, error) {
	finish, err := k.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	directory, err := defaultImportDirectory()
	if err != nil {
		return nil, err
	}
	picker := k.filePicker()
	if picker == nil {
		return nil, fmt.Errorf("select private key file: file picker is not configured")
	}
	path, err := picker.SelectPrivateKey(directory)
	if err != nil {
		return nil, fmt.Errorf("select private key file: %w", err)
	}
	if path == "" {
		return nil, nil
	}
	return readPrivateKeyFile(path)
}

func (k *KeyService) filePicker() keyFilePicker {
	k.pickerMu.RLock()
	defer k.pickerMu.RUnlock()
	return k.picker
}

func defaultImportDirectory() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve SSH import directory: %w", err)
	}
	directory := filepath.Join(home, ".ssh")
	info, err := os.Stat(directory)
	if err == nil && info.IsDir() {
		return directory, nil
	}
	return home, nil
}

func readPrivateKeyFile(path string) (*model.SSHKeyImportFile, error) {
	file, info, err := fsutil.OpenRegularFileFollowingSymlinks(path)
	if err != nil {
		return nil, fmt.Errorf("read private key file: %w", err)
	}
	if info.Size() > maxPrivateKeyFileSize {
		closeErr := file.Close()
		return nil, errors.Join(fmt.Errorf("read private key file: file is too large"), closeErr)
	}
	content, readErr := io.ReadAll(io.LimitReader(file, maxPrivateKeyFileSize+1))
	closeErr := file.Close()
	if readErr != nil || closeErr != nil {
		return nil, fmt.Errorf("read private key file: %w", errors.Join(readErr, closeErr))
	}
	if len(content) > maxPrivateKeyFileSize {
		return nil, fmt.Errorf("read private key file: file is too large")
	}
	return &model.SSHKeyImportFile{Name: filepath.Base(path), PrivateKey: string(content)}, nil
}

const keyNameLimit = 128

func normalizedKeyName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if !utf8.ValidString(name) {
		return "", fmt.Errorf("key name must be valid UTF-8")
	}
	if name == "" || utf8.RuneCountInString(name) > keyNameLimit {
		return "", fmt.Errorf("key name must contain between 1 and %d characters", keyNameLimit)
	}
	if strings.ContainsRune(name, 0) {
		return "", fmt.Errorf("key name contains NUL")
	}
	return name, nil
}

func validatePrivateKeyInput(value string) error {
	if len(value) > maxPrivateKeyFileSize {
		return fmt.Errorf("private key exceeds %d bytes", maxPrivateKeyFileSize)
	}
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("private key is required")
	}
	return nil
}

func (k *KeyService) encryptPrivateKey(privateKey []byte) ([]byte, error) {
	encrypted, err := k.crypto.Encrypt(privateKey)
	if err != nil {
		return nil, fmt.Errorf("encrypt private key: %w", err)
	}
	if len(encrypted) > maxStoredPrivateKeySize {
		clear(encrypted)
		return nil, fmt.Errorf("encrypted private key exceeds %d bytes", maxStoredPrivateKeySize)
	}
	return append([]byte(nil), encrypted...), nil
}

func (k *KeyService) createEncryptedKey(
	name string, keyType model.KeyType, privateKey []byte, publicKey string,
) (*model.SSHKey, error) {
	if err := k.requireCrypto(); err != nil {
		return nil, fmt.Errorf("crypto: %w", err)
	}
	encrypted, err := k.encryptPrivateKey(privateKey)
	if err != nil {
		return nil, err
	}
	defer clear(encrypted)
	return store.CreateKey(k.db, model.SSHKey{
		Name: name, Type: keyType, PrivateKey: strings.Clone(string(encrypted)), PublicKey: publicKey,
	})
}

func matchingPublicKey(value, derived string) (string, error) {
	if len(value) > maxPublicKeyInputBytes {
		return "", fmt.Errorf("public key exceeds %d bytes", maxPublicKeyInputBytes)
	}
	if len(derived) > maxPublicKeyInputBytes {
		return "", fmt.Errorf("derived public key exceeds %d bytes", maxPublicKeyInputBytes)
	}
	normalized := strings.TrimSpace(value)
	provided, _, _, rest, err := gossh.ParseAuthorizedKey([]byte(normalized))
	if err != nil {
		return "", fmt.Errorf("parse public key: %w", err)
	}
	expected, _, _, _, err := gossh.ParseAuthorizedKey([]byte(derived))
	if err != nil {
		return "", fmt.Errorf("parse derived public key: %w", err)
	}
	if provided.Type() != expected.Type() || !bytes.Equal(provided.Marshal(), expected.Marshal()) {
		return "", fmt.Errorf("public key does not match private key")
	}
	if strings.TrimSpace(string(rest)) != "" {
		return "", fmt.Errorf("public key must contain exactly one key")
	}
	return normalized, nil
}

func keyMaterial(key *model.SSHKey, privateKey string) *model.SSHKeyMaterial {
	return &model.SSHKeyMaterial{
		ID: key.ID, Name: key.Name, Type: key.Type, PrivateKey: privateKey,
		PublicKey: key.PublicKey, CreatedAt: key.CreatedAt,
	}
}

const (
	defaultRSABits = 3072
	minRSABits     = 2048
	maxRSABits     = 8192
)

func normalizeRSABits(bits int) (int, error) {
	if bits <= 0 {
		return defaultRSABits, nil
	}
	if bits < minRSABits || bits > maxRSABits {
		return 0, fmt.Errorf("rsa bits must be between %d and %d", minRSABits, maxRSABits)
	}
	if bits%8 != 0 {
		return 0, fmt.Errorf("rsa bits must be a multiple of 8")
	}
	return bits, nil
}
