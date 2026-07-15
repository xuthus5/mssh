package model

import "time"

type KeyType string

const (
	KeyTypeRSA     KeyType = "rsa"
	KeyTypeED25519 KeyType = "ed25519"
	KeyTypeECDSA   KeyType = "ecdsa"
)

type SSHKey struct {
	ID            int64     `json:"id"`
	Name          string    `json:"name"`
	Type          KeyType   `json:"type"`
	PrivateKey    string    `json:"-"`
	PublicKey     string    `json:"public_key"`
	HasPassphrase bool      `json:"has_passphrase"`
	CreatedAt     time.Time `json:"created_at"`
}

type SSHKeyMaterial struct {
	ID         int64     `json:"id"`
	Name       string    `json:"name"`
	Type       KeyType   `json:"type"`
	PrivateKey string    `json:"private_key"`
	PublicKey  string    `json:"public_key"`
	CreatedAt  time.Time `json:"created_at"`
}

type SSHKeyUpdateInput struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	PrivateKey string `json:"private_key"`
	PublicKey  string `json:"public_key"`
}

type SSHKeyImportFile struct {
	Name       string `json:"name"`
	PrivateKey string `json:"private_key"`
}
