package service

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const maxPrivateKeyFileSize = 1024 * 1024

func (k *KeyService) GetMaterial(id int64) (*model.SSHKeyMaterial, error) {
	outcome := "failed"
	defer func() {
		recordAudit(k.db, k.logger, model.AuditEvent{Action: "key_view", TargetType: "key", TargetID: fmt.Sprint(id), Summary: "查看 SSH 密钥材料", Outcome: outcome})
	}()
	key, err := store.GetKey(k.db, id)
	if err != nil {
		return nil, fmt.Errorf("get key material: %w", err)
	}
	if err := k.requireCrypto(); err != nil {
		return nil, fmt.Errorf("get key material: %w", err)
	}
	privateKey, err := k.crypto.Decrypt([]byte(key.PrivateKey))
	if err != nil {
		return nil, fmt.Errorf("get key material: decrypt private key: %w", err)
	}
	outcome = "success"
	return keyMaterial(key, string(privateKey)), nil
}

func (k *KeyService) Update(input model.SSHKeyUpdateInput) (*model.SSHKeyMaterial, error) {
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
	existing, err := store.GetKey(k.db, input.ID)
	if err != nil {
		return nil, fmt.Errorf("update key: %w", err)
	}
	if err := k.requireCrypto(); err != nil {
		return nil, fmt.Errorf("update key: %w", err)
	}
	encrypted, err := k.crypto.Encrypt([]byte(input.PrivateKey))
	if err != nil {
		return nil, fmt.Errorf("update key: encrypt private key: %w", err)
	}
	existing.Name, existing.Type = name, keyType
	existing.PrivateKey, existing.PublicKey = string(encrypted), publicKey
	if err = store.UpdateKey(k.db, *existing); err != nil {
		return nil, fmt.Errorf("update key: %w", err)
	}
	return keyMaterial(existing, input.PrivateKey), nil
}

func (k *KeyService) SelectImportFile() (*model.SSHKeyImportFile, error) {
	directory, err := defaultImportDirectory()
	if err != nil {
		return nil, err
	}
	if k.picker == nil {
		return nil, fmt.Errorf("select private key file: file picker is not configured")
	}
	path, err := k.picker.SelectPrivateKey(directory)
	if err != nil {
		return nil, fmt.Errorf("select private key file: %w", err)
	}
	if path == "" {
		return nil, nil
	}
	return readPrivateKeyFile(path)
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
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("read private key file: %w", err)
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("read private key file: stat: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("read private key file: path is not a regular file")
	}
	if info.Size() > maxPrivateKeyFileSize {
		return nil, fmt.Errorf("read private key file: file is too large")
	}
	content, err := io.ReadAll(io.LimitReader(file, maxPrivateKeyFileSize+1))
	if err != nil {
		return nil, fmt.Errorf("read private key file: %w", err)
	}
	if len(content) > maxPrivateKeyFileSize {
		return nil, fmt.Errorf("read private key file: file is too large")
	}
	return &model.SSHKeyImportFile{Name: filepath.Base(path), PrivateKey: string(content)}, nil
}

const keyNameLimit = 128

func normalizedKeyName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > keyNameLimit {
		return "", fmt.Errorf("key name must contain between 1 and %d characters", keyNameLimit)
	}
	if strings.ContainsRune(name, 0) {
		return "", fmt.Errorf("key name contains NUL")
	}
	return name, nil
}

func matchingPublicKey(value, derived string) (string, error) {
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
