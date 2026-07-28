package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestLoadTerminalPoolSize(t *testing.T) {
	tests := []struct {
		name        string
		value       string
		want        int
		wantErr     bool
		seedSetting bool
	}{
		{name: "missing uses default", want: DefaultTerminalPoolSize},
		{name: "valid value", value: "7", want: 7, seedSetting: true},
		{name: "fraction is floored", value: "4.9", want: 4, seedSetting: true},
		{name: "zero uses default", value: "0", want: DefaultTerminalPoolSize, wantErr: true, seedSetting: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := testutil.NewTestDB(t)
			if test.seedSetting {
				err := store.SetSettings(db, []model.Setting{{
					Key: "terminal.max_pool_size", Namespace: "terminal", Value: test.value, ValueType: "number", Version: 1,
				}})
				require.NoError(t, err)
			}

			got, err := LoadTerminalPoolSize(db)
			if test.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
			assert.Equal(t, test.want, got)
		})
	}
}

func TestNewTerminalServiceUsesStableDefaultPoolSize(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 0, testutil.NewTestLogger())
	assert.Equal(t, DefaultTerminalPoolSize, service.MaxSize())
}
