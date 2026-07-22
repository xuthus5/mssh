package service

import (
	"database/sql"
	"log/slog"
	"reflect"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

type SettingService struct {
	db    *sql.DB
	log   LogConfigurer
	proxy ProxyConfigurer
}

func (s *SettingService) Get(key string) (*model.Setting, error) {
	if err := rejectBlockedSettingKey(key); err != nil {
		return nil, err
	}
	return store.GetSettingEntry(s.db, key)
}

func (s *SettingService) GetMany(keys []string) (map[string]model.Setting, error) {
	for _, key := range keys {
		if err := rejectBlockedSettingKey(key); err != nil {
			return nil, err
		}
	}
	settings, err := store.GetSettings(s.db, keys)
	if err != nil {
		return nil, err
	}
	return filterBlockedSettings(settings), nil
}

func (s *SettingService) List(namespace string) ([]model.Setting, error) {
	settings, err := store.ListSettings(s.db, namespace)
	if err != nil {
		return nil, err
	}
	filtered := make([]model.Setting, 0, len(settings))
	for _, setting := range settings {
		if settingBlocked(setting.Key) {
			continue
		}
		filtered = append(filtered, setting)
	}
	return filtered, nil
}

func (s *SettingService) Set(setting model.SettingInput) error {
	entry := setting.Setting()
	if err := rejectBlockedSettingKey(entry.Key); err != nil {
		return err
	}
	if err := s.validateRuntimeSettings([]model.Setting{entry}); err != nil {
		return err
	}
	if err := store.SetSettings(s.db, []model.Setting{entry}); err != nil {
		return err
	}
	if err := s.applyLogSettings([]model.Setting{entry}); err != nil {
		return err
	}
	return s.applyProxySettings([]model.Setting{entry})
}

func (s *SettingService) SetMany(settings []model.SettingInput) error {
	entries := make([]model.Setting, len(settings))
	for index, setting := range settings {
		entries[index] = setting.Setting()
	}
	if err := rejectBlockedSettings(entries); err != nil {
		return err
	}
	if err := s.validateRuntimeSettings(entries); err != nil {
		return err
	}
	if err := store.SetSettings(s.db, entries); err != nil {
		return err
	}
	if err := s.applyLogSettings(entries); err != nil {
		return err
	}
	return s.applyProxySettings(entries)
}

func (s *SettingService) Delete(key string) error {
	if err := rejectBlockedSettingKey(key); err != nil {
		return err
	}
	return store.DeleteSetting(s.db, key)
}

type SettingServiceOptions struct {
	Log   LogConfigurer
	Proxy ProxyConfigurer
}

func NewSettingService(db *sql.DB, _ *slog.Logger, options ...any) *SettingService {
	service := &SettingService{db: db}
	for _, option := range options {
		switch value := option.(type) {
		case LogConfigurer:
			if !isNilLogConfigurer(value) {
				service.log = value
			}
		case ProxyConfigurer:
			if value != nil {
				service.proxy = value
			}
		case SettingServiceOptions:
			if !isNilLogConfigurer(value.Log) {
				service.log = value.Log
			}
			if value.Proxy != nil {
				service.proxy = value.Proxy
			}
		}
	}
	return service
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
