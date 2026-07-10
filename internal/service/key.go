package service

import (
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

	gossh "golang.org/x/crypto/ssh"

	"mssh/internal/model"
	"mssh/internal/store"
)

type KeyCrypto interface {
	Encrypt(plaintext []byte) ([]byte, error)
	Decrypt(ciphertext []byte) ([]byte, error)
}

type KeyService struct {
	db     *sql.DB
	crypto KeyCrypto
	logger *slog.Logger
}

func NewKeyService(db *sql.DB, crypto KeyCrypto, logger *slog.Logger) *KeyService {
	return &KeyService{db: db, crypto: crypto, logger: logger}
}

func (k *KeyService) List() ([]model.SSHKey, error) {
	k.logger.Info("listing keys")
	return store.ListKeys(k.db)
}

func (k *KeyService) Generate(name string, keyType model.KeyType, bits int) (*model.SSHKey, error) {
	k.logger.Info("generating key", "name", name, "keyType", keyType, "bits", bits)
	var privPEM []byte
	var pubSSH string
	var err error

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

	encrypted, err := k.crypto.Encrypt(privPEM)
	if err != nil {
		return nil, fmt.Errorf("generate key: %w", err)
	}

	key := model.SSHKey{
		Name:       name,
		Type:       keyType,
		PrivateKey: string(encrypted),
		PublicKey:  pubSSH,
	}
	return store.CreateKey(k.db, key)
}

func (k *KeyService) Import(name, privateKeyPEM string) (*model.SSHKey, error) {
	k.logger.Info("importing key", "name", name)
	keyType, pubKey, err := k.extractPublicKeyWithType([]byte(privateKeyPEM))
	if err != nil {
		return nil, fmt.Errorf("import key: %w", err)
	}

	encrypted, err := k.crypto.Encrypt([]byte(privateKeyPEM))
	if err != nil {
		return nil, fmt.Errorf("import key: %w", err)
	}

	key := model.SSHKey{
		Name:       name,
		Type:       keyType,
		PrivateKey: string(encrypted),
		PublicKey:  pubKey,
	}
	return store.CreateKey(k.db, key)
}

func (k *KeyService) Delete(id int64) error {
	k.logger.Info("deleting key", "id", id)
	return store.DeleteKey(k.db, id)
}

func (k *KeyService) ExportPublicKey(id int64) (string, error) {
	key, err := store.GetKey(k.db, id)
	if err != nil {
		return "", fmt.Errorf("export public key: %w", err)
	}
	return key.PublicKey, nil
}

func (k *KeyService) generateRSA(name string, bits int) ([]byte, string, error) {
	if bits <= 0 {
		bits = 3072
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
	block, _ := pem.Decode(privateKeyPEM)
	if block == nil {
		return "", "", fmt.Errorf("invalid PEM data")
	}
	var pk interface{}
	var err error
	var keyType model.KeyType
	switch block.Type {
	case "RSA PRIVATE KEY":
		pk, err = x509.ParsePKCS1PrivateKey(block.Bytes)
		keyType = model.KeyTypeRSA
	case "EC PRIVATE KEY":
		pk, err = x509.ParseECPrivateKey(block.Bytes)
		keyType = model.KeyTypeECDSA
	case "PRIVATE KEY":
		pk, err = x509.ParsePKCS8PrivateKey(block.Bytes)
		switch pk.(type) {
		case *rsa.PrivateKey:
			keyType = model.KeyTypeRSA
		case ed25519.PrivateKey:
			keyType = model.KeyTypeED25519
		case *ecdsa.PrivateKey:
			keyType = model.KeyTypeECDSA
		default:
			return "", "", fmt.Errorf("unsupported key type in PKCS#8")
		}
	default:
		return "", "", fmt.Errorf("unsupported key type: %s", block.Type)
	}
	if err != nil {
		return "", "", fmt.Errorf("parse private key: %w", err)
	}

	signer, err := gossh.NewSignerFromKey(pk)
	if err != nil {
		return "", "", fmt.Errorf("create signer: %w", err)
	}
	return keyType, string(gossh.MarshalAuthorizedKey(signer.PublicKey())), nil
}
