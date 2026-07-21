package service

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"strings"

	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/model"
)

func parsePEMPrivateKey(block *pem.Block) (any, model.KeyType, error) {
	switch block.Type {
	case "RSA PRIVATE KEY":
		pk, err := x509.ParsePKCS1PrivateKey(block.Bytes)
		if err != nil {
			return nil, "", fmt.Errorf("parse private key: %w", err)
		}
		return pk, model.KeyTypeRSA, nil
	case "EC PRIVATE KEY":
		pk, err := x509.ParseECPrivateKey(block.Bytes)
		if err != nil {
			return nil, "", fmt.Errorf("parse private key: %w", err)
		}
		return pk, model.KeyTypeECDSA, nil
	case "PRIVATE KEY":
		return parsePKCS8PrivateKey(block.Bytes)
	default:
		return nil, "", fmt.Errorf("unsupported key type: %s", block.Type)
	}
}

func parsePKCS8PrivateKey(data []byte) (any, model.KeyType, error) {
	pk, err := x509.ParsePKCS8PrivateKey(data)
	if err != nil {
		return nil, "", fmt.Errorf("parse private key: %w", err)
	}
	switch pk.(type) {
	case *rsa.PrivateKey:
		return pk, model.KeyTypeRSA, nil
	case ed25519.PrivateKey:
		return pk, model.KeyTypeED25519, nil
	case *ecdsa.PrivateKey:
		return pk, model.KeyTypeECDSA, nil
	default:
		return nil, "", fmt.Errorf("unsupported key type in PKCS#8")
	}
}

func publicKeyFromOpenSSH(privateKeyPEM []byte) (model.KeyType, string, error) {
	signer, err := gossh.ParsePrivateKey(privateKeyPEM)
	if err != nil {
		return "", "", fmt.Errorf("parse OpenSSH key: %w", err)
	}
	keyType, err := keyTypeFromPublic(signer.PublicKey().Type())
	if err != nil {
		return "", "", err
	}
	return keyType, string(gossh.MarshalAuthorizedKey(signer.PublicKey())), nil
}

func keyTypeFromPublic(pubStr string) (model.KeyType, error) {
	switch {
	case strings.HasPrefix(pubStr, "ssh-rsa"):
		return model.KeyTypeRSA, nil
	case strings.HasPrefix(pubStr, "ssh-ed25519"):
		return model.KeyTypeED25519, nil
	case strings.HasPrefix(pubStr, "ecdsa-"):
		return model.KeyTypeECDSA, nil
	default:
		return "", fmt.Errorf("unsupported key type: %s", pubStr)
	}
}
