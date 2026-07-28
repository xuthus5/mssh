package service

import (
	"fmt"
	"strings"
	"unicode/utf8"

	gossh "golang.org/x/crypto/ssh"

	"github.com/xuthus5/mssh/internal/model"
)

func validateSnapshotSSHKeys(rows []map[string]any) error {
	seen := make(map[int64]struct{}, len(rows))
	for index, row := range rows {
		key, err := snapshotSSHKeyFromRow(row)
		if err != nil {
			return fmt.Errorf("table ssh_keys row %d: %w", index, err)
		}
		if _, duplicate := seen[key.ID]; duplicate {
			return fmt.Errorf("table ssh_keys row %d: duplicate key id %d", index, key.ID)
		}
		if err := validateSnapshotSSHKey(key); err != nil {
			return fmt.Errorf("table ssh_keys row %d: %w", index, err)
		}
		seen[key.ID] = struct{}{}
	}
	return nil
}

func snapshotSSHKeyFromRow(row map[string]any) (model.SSHKey, error) {
	var key model.SSHKey
	var err error
	if key.ID, err = snapshotInt64Field(row, "id"); err != nil {
		return model.SSHKey{}, err
	}
	if key.Name, err = snapshotStringField(row, "name"); err != nil {
		return model.SSHKey{}, err
	}
	keyType, err := snapshotStringField(row, "type")
	if err != nil {
		return model.SSHKey{}, err
	}
	key.Type = model.KeyType(keyType)
	if key.PrivateKey, err = snapshotStringField(row, "private_key"); err != nil {
		return model.SSHKey{}, err
	}
	if key.PublicKey, err = snapshotStringField(row, "public_key"); err != nil {
		return model.SSHKey{}, err
	}
	if key.HasPassphrase, err = snapshotBoolIntegerField(row, "has_passphrase"); err != nil {
		return model.SSHKey{}, err
	}
	key.CreatedAt, err = snapshotTimeField(row, "created_at")
	return key, err
}

func validateSnapshotSSHKey(key model.SSHKey) error {
	if key.ID <= 0 {
		return fmt.Errorf("invalid key id")
	}
	normalizedName, err := normalizedKeyName(key.Name)
	if err != nil {
		return err
	}
	if normalizedName != key.Name {
		return fmt.Errorf("key name must not contain surrounding whitespace")
	}
	if err := validateSnapshotSSHKeyType(key.Type); err != nil {
		return err
	}
	if err := validateSnapshotPrivateKey(key.PrivateKey); err != nil {
		return err
	}
	return validateSnapshotPublicKey(key.PublicKey, key.Type)
}

func validateSnapshotSSHKeyType(keyType model.KeyType) error {
	switch keyType {
	case model.KeyTypeRSA, model.KeyTypeED25519, model.KeyTypeECDSA:
		return nil
	default:
		return fmt.Errorf("unsupported key type %q", keyType)
	}
}

func validateSnapshotPrivateKey(value string) error {
	if value == "" {
		return fmt.Errorf("encrypted private key is required")
	}
	if len(value) > maxStoredPrivateKeySize {
		return fmt.Errorf("encrypted private key exceeds %d bytes", maxStoredPrivateKeySize)
	}
	return validateBase64AESGCMEnvelope(value, maxPrivateKeyFileSize, "encrypted private key")
}

func validateSnapshotPublicKey(value string, expected model.KeyType) error {
	if len(value) > maxPublicKeyInputBytes {
		return fmt.Errorf("public key exceeds %d bytes", maxPublicKeyInputBytes)
	}
	if !utf8.ValidString(value) {
		return fmt.Errorf("public key must be valid UTF-8")
	}
	if strings.ContainsRune(value, 0) {
		return fmt.Errorf("public key contains NUL")
	}
	parsed, _, _, rest, err := gossh.ParseAuthorizedKey([]byte(strings.TrimSpace(value)))
	if err != nil {
		return fmt.Errorf("parse public key: %w", err)
	}
	if strings.TrimSpace(string(rest)) != "" {
		return fmt.Errorf("public key must contain exactly one key")
	}
	actual, err := snapshotPublicKeyType(parsed.Type())
	if err != nil {
		return err
	}
	if actual != expected {
		return fmt.Errorf("public key type %q does not match stored type %q", actual, expected)
	}
	return nil
}

func snapshotPublicKeyType(algorithm string) (model.KeyType, error) {
	switch algorithm {
	case gossh.KeyAlgoRSA:
		return model.KeyTypeRSA, nil
	case gossh.KeyAlgoED25519:
		return model.KeyTypeED25519, nil
	case gossh.KeyAlgoECDSA256, gossh.KeyAlgoECDSA384, gossh.KeyAlgoECDSA521:
		return model.KeyTypeECDSA, nil
	default:
		return "", fmt.Errorf("unsupported public key algorithm %q", algorithm)
	}
}
