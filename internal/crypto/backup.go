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
	BackupFormatVersion       = 1
	backupKeyLength           = 32
	backupMinMasterKeyLength  = 12
	backupSaltLength          = 16
	backupNonceLength         = 12
	backupGCMTagLength        = 16
	backupMaxCiphertextLength = 32 * 1024 * 1024
	backupMaxPlaintextLength  = backupMaxCiphertextLength - backupGCMTagLength
	backupArgonTime           = 3
	backupArgonMemory         = 64 * 1024
	backupArgonThreads        = 2
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
	return EncryptBackupWithAAD(plaintext, masterKey, nil)
}

func EncryptBackupWithAAD(plaintext, masterKey, additionalData []byte) (BackupEnvelope, error) {
	if err := validateBackupMasterKey(masterKey); err != nil {
		return BackupEnvelope{}, err
	}
	if len(plaintext) > backupMaxPlaintextLength {
		return BackupEnvelope{}, errors.New("backup plaintext length is invalid")
	}
	salt, err := randomBytes(backupSaltLength)
	if err != nil {
		return BackupEnvelope{}, err
	}
	aead, err := newBackupAEAD(masterKey, salt, backupArgonTime, backupArgonMemory, backupArgonThreads)
	if err != nil {
		return BackupEnvelope{}, err
	}
	nonce, err := randomBytes(aead.NonceSize())
	if err != nil {
		return BackupEnvelope{}, err
	}
	ciphertext := aead.Seal(nil, nonce, plaintext, additionalData)
	return BackupEnvelope{
		FormatVersion: BackupFormatVersion, Cipher: "AES-256-GCM", KDF: "Argon2id",
		ArgonTime: backupArgonTime, ArgonMemory: backupArgonMemory, ArgonThreads: backupArgonThreads,
		Salt: base64.StdEncoding.EncodeToString(salt), Nonce: base64.StdEncoding.EncodeToString(nonce),
		Ciphertext: base64.StdEncoding.EncodeToString(ciphertext),
	}, nil
}

func DecryptBackup(envelope BackupEnvelope, masterKey []byte) ([]byte, error) {
	return DecryptBackupWithAAD(envelope, masterKey, nil)
}

func DecryptBackupWithAAD(envelope BackupEnvelope, masterKey, additionalData []byte) ([]byte, error) {
	if err := validateBackupEnvelope(envelope, masterKey); err != nil {
		return nil, err
	}
	salt, nonce, ciphertext, err := decodeEnvelope(envelope)
	if err != nil {
		return nil, err
	}
	if err := validateDecodedEnvelope(salt, nonce, ciphertext); err != nil {
		return nil, err
	}
	aead, err := newBackupAEAD(masterKey, salt, envelope.ArgonTime, envelope.ArgonMemory, envelope.ArgonThreads)
	if err != nil {
		return nil, err
	}
	plaintext, err := aead.Open(nil, nonce, ciphertext, additionalData)
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

func newBackupAEAD(masterKey, salt []byte, time, memory uint32, threads uint8) (cipher.AEAD, error) {
	block, err := aes.NewCipher(deriveBackupKey(masterKey, salt, time, memory, threads))
	if err != nil {
		return nil, fmt.Errorf("create backup cipher: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("create backup GCM: %w", err)
	}
	return aead, nil
}

func validateBackupEnvelope(envelope BackupEnvelope, masterKey []byte) error {
	if envelope.FormatVersion != BackupFormatVersion || envelope.Cipher != "AES-256-GCM" || envelope.KDF != "Argon2id" {
		return errors.New("unsupported backup encryption format")
	}
	if err := validateBackupMasterKey(masterKey); err != nil {
		return err
	}
	if envelope.ArgonTime != backupArgonTime || envelope.ArgonMemory != backupArgonMemory || envelope.ArgonThreads != backupArgonThreads {
		return errors.New("backup KDF parameters are invalid")
	}
	if len(envelope.Salt) > base64.StdEncoding.EncodedLen(backupSaltLength) {
		return errors.New("backup salt length is invalid")
	}
	if len(envelope.Nonce) > base64.StdEncoding.EncodedLen(backupNonceLength) {
		return errors.New("backup nonce length is invalid")
	}
	if len(envelope.Ciphertext) > base64.StdEncoding.EncodedLen(backupMaxCiphertextLength) {
		return errors.New("backup ciphertext length is invalid")
	}
	return nil
}

func validateBackupMasterKey(masterKey []byte) error {
	if len(masterKey) < backupMinMasterKeyLength {
		return errors.New("master key must contain at least 12 bytes")
	}
	return nil
}

func validateDecodedEnvelope(salt, nonce, ciphertext []byte) error {
	if len(salt) != backupSaltLength {
		return errors.New("backup salt length is invalid")
	}
	if len(nonce) != backupNonceLength {
		return errors.New("backup nonce length is invalid")
	}
	if len(ciphertext) < backupGCMTagLength || len(ciphertext) > backupMaxCiphertextLength {
		return errors.New("backup ciphertext length is invalid")
	}
	return nil
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
