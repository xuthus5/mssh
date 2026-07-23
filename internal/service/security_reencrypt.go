package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

type reencryptPlan struct {
	keys     []reencryptKeyUpdate
	sessions []reencryptSessionUpdate
	settings []model.Setting
}

type reencryptKeyUpdate struct {
	id         int64
	privateKey string
}

type reencryptSessionUpdate struct {
	id       int64
	password string
}

func (s *SecurityService) reencryptProtectedData(oldDEK, newDEK []byte) error {
	oldCrypto := &staticCrypto{key: oldDEK}
	newCrypto := &staticCrypto{key: newDEK}
	plan, err := buildReencryptPlan(s.db, oldCrypto, newCrypto)
	if err != nil {
		return err
	}
	return applyReencryptPlan(s.db, plan)
}

func buildReencryptPlan(db *sql.DB, oldCrypto, newCrypto KeyCrypto) (reencryptPlan, error) {
	keys, err := planSSHKeyUpdates(db, oldCrypto, newCrypto)
	if err != nil {
		return reencryptPlan{}, err
	}
	sessions, err := planSessionPasswordUpdates(db, oldCrypto, newCrypto)
	if err != nil {
		return reencryptPlan{}, err
	}
	settings, err := planSettingSecretUpdates(db, oldCrypto, newCrypto)
	if err != nil {
		return reencryptPlan{}, err
	}
	return reencryptPlan{keys: keys, sessions: sessions, settings: settings}, nil
}

func planSSHKeyUpdates(db *sql.DB, oldCrypto, newCrypto KeyCrypto) ([]reencryptKeyUpdate, error) {
	keyIDs, err := listSSHKeyIDs(db)
	if err != nil {
		return nil, fmt.Errorf("list keys: %w", err)
	}
	updates := make([]reencryptKeyUpdate, 0, len(keyIDs))
	for _, keyID := range keyIDs {
		key, err := store.GetKey(db, keyID)
		if err != nil {
			return nil, fmt.Errorf("load key %d: %w", keyID, err)
		}
		plain, err := oldCrypto.Decrypt([]byte(key.PrivateKey))
		if err != nil {
			return nil, fmt.Errorf("decrypt key %d: %w", keyID, err)
		}
		sealed, err := newCrypto.Encrypt(plain)
		if err != nil {
			return nil, fmt.Errorf("encrypt key %d: %w", keyID, err)
		}
		updates = append(updates, reencryptKeyUpdate{id: keyID, privateKey: string(sealed)})
	}
	return updates, nil
}

func planSessionPasswordUpdates(db *sql.DB, oldCrypto, newCrypto KeyCrypto) ([]reencryptSessionUpdate, error) {
	sessions, err := store.ListSessions(db, nil)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	updates := make([]reencryptSessionUpdate, 0)
	for _, session := range sessions {
		if session.Password == "" {
			continue
		}
		sealed, err := reencryptSessionPassword(oldCrypto, newCrypto, session.Password)
		if err != nil {
			return nil, fmt.Errorf("session %d password: %w", session.ID, err)
		}
		updates = append(updates, reencryptSessionUpdate{id: session.ID, password: sealed})
	}
	return updates, nil
}

func planSettingSecretUpdates(db *sql.DB, oldCrypto, newCrypto KeyCrypto) ([]model.Setting, error) {
	var settings []model.Setting
	proxy, err := planProxyPasswordSetting(db, oldCrypto, newCrypto)
	if err != nil {
		return nil, err
	}
	if proxy != nil {
		settings = append(settings, *proxy)
	}
	for _, key := range []string{syncGistTokenSetting, syncWebDAVPasswordSetting, syncS3SecretSetting} {
		setting, err := planSyncCredentialSetting(db, key, oldCrypto, newCrypto)
		if err != nil {
			return nil, err
		}
		if setting != nil {
			settings = append(settings, *setting)
		}
	}
	return settings, nil
}

func planProxyPasswordSetting(db *sql.DB, oldCrypto, newCrypto KeyCrypto) (*model.Setting, error) {
	entry, err := store.GetSettingEntry(db, applicationProxyPasswordSetting)
	if err != nil {
		return nil, fmt.Errorf("load proxy password: %w", err)
	}
	if entry == nil || strings.TrimSpace(entry.Value) == "" {
		return nil, nil
	}
	var raw string
	if err := json.Unmarshal([]byte(entry.Value), &raw); err != nil {
		return nil, fmt.Errorf("decode proxy password: %w", err)
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	plain, err := decryptProxyPasswordValue(oldCrypto, raw)
	if err != nil {
		return nil, fmt.Errorf("decrypt proxy password: %w", err)
	}
	if plain == "" {
		return nil, nil
	}
	sealed, err := encryptProxyPasswordValue(newCrypto, plain)
	if err != nil {
		return nil, fmt.Errorf("encrypt proxy password: %w", err)
	}
	payload, err := json.Marshal(sealed)
	if err != nil {
		return nil, err
	}
	entry.Value = string(payload)
	entry.ValueType = "string"
	if entry.Namespace == "" {
		entry.Namespace = "application"
	}
	if entry.Version == 0 {
		entry.Version = 1
	}
	return entry, nil
}

func planSyncCredentialSetting(db *sql.DB, key string, oldCrypto, newCrypto KeyCrypto) (*model.Setting, error) {
	var encrypted string
	if err := readSyncSetting(db, key, &encrypted); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load %s: %w", key, err)
	}
	encrypted = strings.TrimSpace(encrypted)
	if encrypted == "" {
		return nil, nil
	}
	plain, err := oldCrypto.Decrypt([]byte(encrypted))
	if err != nil {
		return nil, fmt.Errorf("decrypt %s: %w", key, err)
	}
	sealed, err := newCrypto.Encrypt(plain)
	if err != nil {
		return nil, fmt.Errorf("encrypt %s: %w", key, err)
	}
	payload, err := json.Marshal(string(sealed))
	if err != nil {
		return nil, err
	}
	return &model.Setting{
		Key: key, Namespace: "sync", Value: string(payload), ValueType: "string", Version: 1,
	}, nil
}
