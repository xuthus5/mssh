package service

import (
	"encoding/json"
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
)

func buildSyncSetting(key string, value any) (model.Setting, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return model.Setting{}, fmt.Errorf("encode sync setting %s: %w", key, err)
	}
	return model.Setting{
		Key: key, Namespace: "sync", Value: string(encoded),
		ValueType: syncSettingType(value), Version: 1,
	}, nil
}
