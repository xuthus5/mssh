package service

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"database/sql"
	"encoding/pem"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

type KeyCrypto interface {
	Encrypt(plaintext []byte) ([]byte, error)
	Decrypt(ciphertext []byte) ([]byte, error)
}

type keyFilePicker interface {
	SelectPrivateKey(directory string) (string, error)
}

type KeyService struct {
	db        *sql.DB
	crypto    KeyCrypto
	logger    *slog.Logger
	pickerMu  sync.RWMutex
	picker    keyFilePicker
	lifecycle serviceOperationGate
}

func NewKeyService(db *sql.DB, crypto KeyCrypto, logger *slog.Logger) *KeyService {
	return &KeyService{db: db, crypto: crypto, logger: logger}
}

func (k *KeyService) requireCrypto() error {
	if k.crypto == nil {
		return ErrVaultLocked
	}
	if runtime, ok := k.crypto.(*CryptoRuntime); ok {
		return runtime.RequireUnlocked()
	}
	return nil
}

//wails:ignore
func (k *KeyService) SetFilePicker(picker keyFilePicker) {
	k.pickerMu.Lock()
	defer k.pickerMu.Unlock()
	k.picker = picker
}

func (k *KeyService) List() ([]model.SSHKey, error) {
	finish, err := k.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	k.logger.Info("listing keys")
	return store.ListKeys(k.db)
}

func (k *KeyService) Generate(name string, keyType model.KeyType, bits int) (*model.SSHKeyMaterial, error) {
	finish, err := k.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	name, err = normalizedKeyName(name)
	if err != nil {
		return nil, fmt.Errorf("generate key: %w", err)
	}
	k.logger.Info("generating key", "name", name, "keyType", keyType, "bits", bits)
	var privPEM []byte
	var pubSSH string

	switch keyType {
	case model.KeyTypeRSA:
		privPEM, pubSSH, err = k.generateRSA(name, bits)
	case model.KeyTypeED25519:
		privPEM, pubSSH, err = k.generateED25519(name)
	case model.KeyTypeECDSA:
		privPEM, pubSSH, err = k.generateECDSA(name)
	default:
		return nil, fmt.Errorf("generate key: unsupported key type %s", keyType)
	}
	if err != nil {
		return nil, fmt.Errorf("generate key: %w", err)
	}
	defer clear(privPEM)

	var created *model.SSHKey
	err = withCryptoOperation(k.crypto, func() error {
		var operationErr error
		created, operationErr = k.createEncryptedKey(name, keyType, privPEM, pubSSH)
		return operationErr
	})
	if err != nil {
		return nil, fmt.Errorf("generate key: %w", err)
	}
	return keyMaterial(created, strings.Clone(string(privPEM))), nil
}

func (k *KeyService) Import(name, privateKeyPEM string) (*model.SSHKey, error) {
	finish, err := k.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	name, err = normalizedKeyName(name)
	if err != nil {
		return nil, fmt.Errorf("import key: %w", err)
	}
	if err := validatePrivateKeyInput(privateKeyPEM); err != nil {
		return nil, fmt.Errorf("import key: %w", err)
	}
	k.logger.Info("importing key", "name", name)
	keyType, pubKey, err := k.extractPublicKeyWithType([]byte(privateKeyPEM))
	if err != nil {
		return nil, fmt.Errorf("import key: %w", err)
	}

	privateKeyBytes := []byte(privateKeyPEM)
	defer clear(privateKeyBytes)
	var created *model.SSHKey
	err = withCryptoOperation(k.crypto, func() error {
		var operationErr error
		created, operationErr = k.createEncryptedKey(name, keyType, privateKeyBytes, pubKey)
		return operationErr
	})
	if err != nil {
		return nil, fmt.Errorf("import key: %w", err)
	}
	return created, nil
}

func (k *KeyService) Delete(id int64) error {
	finish, err := k.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	if id <= 0 {
		return fmt.Errorf("invalid key id")
	}
	outcome := "failed"
	defer func() {
		recordAudit(k.db, k.logger, model.AuditEvent{Action: "delete", TargetType: "key", TargetID: fmt.Sprint(id), Summary: "删除 SSH 密钥", Outcome: outcome})
	}()
	k.logger.Info("deleting key", "id", id)
	err = store.DeleteKey(k.db, id)
	if err == nil {
		outcome = "success"
	}
	return err
}

func (k *KeyService) UsageCount(id int64) (int, error) {
	finish, err := k.beginOperation()
	if err != nil {
		return 0, err
	}
	defer finish()
	if id <= 0 {
		return 0, fmt.Errorf("invalid key id")
	}
	var count int
	if err := k.db.QueryRow("SELECT COUNT(*) FROM sessions WHERE key_id = ?", id).Scan(&count); err != nil {
		return 0, fmt.Errorf("key usage count: %w", err)
	}
	return count, nil
}

func (k *KeyService) ExportPublicKey(id int64) (string, error) {
	finish, err := k.beginOperation()
	if err != nil {
		return "", err
	}
	defer finish()
	if id <= 0 {
		return "", fmt.Errorf("invalid key id")
	}
	key, err := store.GetKey(k.db, id)
	if err != nil {
		return "", fmt.Errorf("export public key: %w", err)
	}
	return key.PublicKey, nil
}

func (k *KeyService) generateRSA(name string, bits int) ([]byte, string, error) {
	bits, err := normalizeRSABits(bits)
	if err != nil {
		return nil, "", err
	}
	pk, err := rsa.GenerateKey(rand.Reader, bits)
	if err != nil {
		return nil, "", err
	}
	pkBytes, err := x509.MarshalPKCS8PrivateKey(pk)
	if err != nil {
		return nil, "", err
	}
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkBytes})
	pub, pubErr := gossh.NewPublicKey(&pk.PublicKey)
	if pubErr != nil {
		return nil, "", pubErr
	}
	pubSSH := string(gossh.MarshalAuthorizedKey(pub))
	return privPEM, pubSSH, nil
}

func (k *KeyService) generateED25519(name string) ([]byte, string, error) {
	_, pk, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, "", err
	}
	pkBytes, err := x509.MarshalPKCS8PrivateKey(pk)
	if err != nil {
		return nil, "", err
	}
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkBytes})
	pub, pubErr := gossh.NewPublicKey(pk.Public())
	if pubErr != nil {
		return nil, "", pubErr
	}
	pubSSH := string(gossh.MarshalAuthorizedKey(pub))
	return privPEM, pubSSH, nil
}

func (k *KeyService) generateECDSA(name string) ([]byte, string, error) {
	pk, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, "", err
	}
	pkBytes, err := x509.MarshalPKCS8PrivateKey(pk)
	if err != nil {
		return nil, "", err
	}
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkBytes})
	pub, pubErr := gossh.NewPublicKey(&pk.PublicKey)
	if pubErr != nil {
		return nil, "", pubErr
	}
	pubSSH := string(gossh.MarshalAuthorizedKey(pub))
	return privPEM, pubSSH, nil
}

func (k *KeyService) extractPublicKey(privateKeyPEM []byte) (string, error) {
	_, pubKey, err := k.extractPublicKeyWithType(privateKeyPEM)
	return pubKey, err
}

func (k *KeyService) extractPublicKeyWithType(privateKeyPEM []byte) (model.KeyType, string, error) {
	if len(privateKeyPEM) > maxPrivateKeyFileSize {
		return "", "", fmt.Errorf("private key exceeds %d bytes", maxPrivateKeyFileSize)
	}
	block, rest := pem.Decode(bytes.TrimSpace(privateKeyPEM))
	if block == nil {
		return "", "", fmt.Errorf("invalid PEM data")
	}
	if len(bytes.TrimSpace(rest)) != 0 {
		return "", "", fmt.Errorf("private key must contain exactly one private key")
	}
	if block.Type == "OPENSSH PRIVATE KEY" {
		return publicKeyFromOpenSSH(privateKeyPEM)
	}
	pk, keyType, err := parsePEMPrivateKey(block)
	if err != nil {
		return "", "", err
	}
	signer, err := gossh.NewSignerFromKey(pk)
	if err != nil {
		return "", "", fmt.Errorf("create signer: %w", err)
	}
	return keyType, string(gossh.MarshalAuthorizedKey(signer.PublicKey())), nil
}
