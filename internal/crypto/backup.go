package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"golang.org/x/crypto/argon2"
)

const (
	BackupFormatVersion = 1
	backupKeyLength     = 32
	backupSaltLength    = 16
	backupArgonTime     = 3
	backupArgonMemory   = 64 * 1024
	backupArgonThreads  = 2
)

type BackupEnvelope struct {
	FormatVersion int    `json:"format_version"`
	Cipher        string `json:"cipher"`
	KDF           string `json:"kdf"`
	ArgonTime     uint32 `json:"argon_time"`
	ArgonMemory   uint32 `json:"argon_memory"`
	ArgonThreads  uint8  `json:"argon_threads"`
	Salt          string `json:"salt"`
	Nonce         string `json:"nonce"`
	Ciphertext    string `json:"ciphertext"`
}

func EncryptBackup(plaintext, masterKey []byte) (BackupEnvelope, error) {
	if len(masterKey) < 12 {
		return BackupEnvelope{}, errors.New("master key must contain at least 12 bytes")
	}
	salt, err := randomBytes(backupSaltLength)
	if err != nil {
		return BackupEnvelope{}, err
	}
	block, err := aes.NewCipher(deriveBackupKey(masterKey, salt, backupArgonTime, backupArgonMemory, backupArgonThreads))
	if err != nil {
		return BackupEnvelope{}, fmt.Errorf("create backup cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return BackupEnvelope{}, fmt.Errorf("create backup GCM: %w", err)
	}
	nonce, err := randomBytes(aead.NonceSize())
	if err != nil {
		return BackupEnvelope{}, err
	}
	ciphertext := aead.Seal(nil, nonce, plaintext, nil)
	return BackupEnvelope{
		FormatVersion: BackupFormatVersion, Cipher: "AES-256-GCM", KDF: "Argon2id",
		ArgonTime: backupArgonTime, ArgonMemory: backupArgonMemory, ArgonThreads: backupArgonThreads,
		Salt: base64.StdEncoding.EncodeToString(salt), Nonce: base64.StdEncoding.EncodeToString(nonce),
		Ciphertext: base64.StdEncoding.EncodeToString(ciphertext),
	}, nil
}

func DecryptBackup(envelope BackupEnvelope, masterKey []byte) ([]byte, error) {
	if envelope.FormatVersion != BackupFormatVersion || envelope.Cipher != "AES-256-GCM" || envelope.KDF != "Argon2id" {
		return nil, errors.New("unsupported backup encryption format")
	}
	salt, nonce, ciphertext, err := decodeEnvelope(envelope)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(deriveBackupKey(masterKey, salt, envelope.ArgonTime, envelope.ArgonMemory, envelope.ArgonThreads))
	if err != nil {
		return nil, fmt.Errorf("create backup cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create backup GCM: %w", err)
	}
	plaintext, err := aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, errors.New("decrypt backup: invalid master key or corrupted backup")
	}
	return plaintext, nil
}

func EncodeBackup(envelope BackupEnvelope) ([]byte, error) {
	content, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode backup envelope: %w", err)
	}
	return append(content, '\n'), nil
}

func randomBytes(size int) ([]byte, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return nil, fmt.Errorf("generate backup randomness: %w", err)
	}
	return value, nil
}

func deriveBackupKey(masterKey, salt []byte, time, memory uint32, threads uint8) []byte {
	return argon2.IDKey(masterKey, salt, time, memory, threads, backupKeyLength)
}

func decodeEnvelope(envelope BackupEnvelope) ([]byte, []byte, []byte, error) {
	salt, err := base64.StdEncoding.DecodeString(envelope.Salt)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("decode backup salt: %w", err)
	}
	nonce, err := base64.StdEncoding.DecodeString(envelope.Nonce)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("decode backup nonce: %w", err)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(envelope.Ciphertext)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("decode backup ciphertext: %w", err)
	}
	return salt, nonce, ciphertext, nil
}
