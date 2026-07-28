package service

import (
	"database/sql"
	"log/slog"
	"reflect"
	"sync"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

type SettingService struct {
	db        *sql.DB
	mu        sync.Mutex
	log       LogConfigurer
	proxy     ProxyConfigurer
	crypto    KeyCrypto
	lifecycle serviceOperationGate
}

func (s *SettingService) Get(key string) (*model.Setting, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	if err := rejectBlockedSettingKey(key); err != nil {
		return nil, err
	}
	setting, err := store.GetSettingEntry(s.db, key)
	if err != nil {
		return nil, err
	}
	redactProxyPasswordSetting(setting)
	return setting, nil
}

func (s *SettingService) GetMany(keys []string) (map[string]model.Setting, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	if err := store.ValidateSettingKeys(keys); err != nil {
		return nil, err
	}
	for _, key := range keys {
		if err := rejectBlockedSettingKey(key); err != nil {
			return nil, err
		}
	}
	settings, err := store.GetSettings(s.db, keys)
	if err != nil {
		return nil, err
	}
	filtered := filterBlockedSettings(settings)
	redactProxyPasswordSettings(filtered)
	return filtered, nil
}

func (s *SettingService) List(namespace string) ([]model.Setting, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	if err := store.ValidateSettingNamespace(namespace); err != nil {
		return nil, err
	}
	settings, err := store.ListSettings(s.db, namespace)
	if err != nil {
		return nil, err
	}
	filtered := make([]model.Setting, 0, len(settings))
	for _, setting := range settings {
		if settingBlocked(setting.Key) {
			continue
		}
		item := setting
		redactProxyPasswordSetting(&item)
		filtered = append(filtered, item)
	}
	return filtered, nil
}

func (s *SettingService) Set(setting model.SettingInput) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	entries, err := settingEntriesFromInputs([]model.SettingInput{setting})
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return withCryptoOperation(s.crypto, func() error {
		return s.setEntries(entries)
	})
}

func (s *SettingService) SetMany(settings []model.SettingInput) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	entries, err := settingEntriesFromInputs(settings)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return withCryptoOperation(s.crypto, func() error {
		return s.setEntries(entries)
	})
}

func (s *SettingService) setEntries(entries []model.Setting) error {
	if err := store.ValidateSettings(entries); err != nil {
		return err
	}
	if err := rejectBlockedSettings(entries); err != nil {
		return err
	}
	entries, err := s.prepareProxyPasswordWrites(entries)
	if err != nil {
		return err
	}
	if err := store.ValidateSettings(entries); err != nil {
		return err
	}
	if err := s.validateRuntimeSettings(entries); err != nil {
		return err
	}
	return s.persistAndApply(entries)
}

func settingEntriesFromInputs(inputs []model.SettingInput) ([]model.Setting, error) {
	if err := store.ValidateSettingBatchSize(len(inputs)); err != nil {
		return nil, err
	}
	entries := make([]model.Setting, len(inputs))
	for index, input := range inputs {
		entries[index] = input.Setting()
	}
	if err := store.ValidateSettings(entries); err != nil {
		return nil, err
	}
	return entries, nil
}

func (s *SettingService) Delete(key string) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	s.mu.Lock()
	defer s.mu.Unlock()
	return withCryptoOperation(s.crypto, func() error {
		if err := rejectBlockedSettingKey(key); err != nil {
			return err
		}
		return store.DeleteSetting(s.db, key)
	})
}

type SettingServiceOptions struct {
	Log    LogConfigurer
	Proxy  ProxyConfigurer
	Crypto KeyCrypto
}

func NewSettingService(db *sql.DB, _ *slog.Logger, options ...any) *SettingService {
	service := &SettingService{db: db}
	for _, option := range options {
		applySettingServiceOption(service, option)
	}
	return service
}

func applySettingServiceOption(service *SettingService, option any) {
	switch value := option.(type) {
	case LogConfigurer:
		if !isNilLogConfigurer(value) {
			service.log = value
		}
	case ProxyConfigurer:
		if value != nil {
			service.proxy = value
		}
	case KeyCrypto:
		if value != nil {
			service.crypto = value
		}
	case SettingServiceOptions:
		applySettingServiceOptionsStruct(service, value)
	}
}

func applySettingServiceOptionsStruct(service *SettingService, value SettingServiceOptions) {
	if !isNilLogConfigurer(value.Log) {
		service.log = value.Log
	}
	if value.Proxy != nil {
		service.proxy = value.Proxy
	}
	if value.Crypto != nil {
		service.crypto = value.Crypto
	}
}

func isNilLogConfigurer(log LogConfigurer) bool {
	if log == nil {
		return true
	}
	value := reflect.ValueOf(log)
	switch value.Kind() {
	case reflect.Pointer, reflect.Interface, reflect.Map, reflect.Slice, reflect.Func, reflect.Chan:
		return value.IsNil()
	default:
		return false
	}
}
