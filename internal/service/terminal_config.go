package service

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/xuthus5/mssh/internal/store"
)

const terminalPoolSizeSettingKey = "terminal.max_pool_size"

// DefaultTerminalPoolSize is the fallback terminal pool capacity used by the backend and frontend.
const DefaultTerminalPoolSize = 10

func LoadTerminalPoolSize(db *sql.DB) (int, error) {
	if db == nil {
		return DefaultTerminalPoolSize, fmt.Errorf("database is required")
	}
	setting, err := store.GetSettingEntry(db, terminalPoolSizeSettingKey)
	if err != nil {
		return DefaultTerminalPoolSize, fmt.Errorf("load terminal pool size: %w", err)
	}
	if setting == nil {
		return DefaultTerminalPoolSize, nil
	}
	value, err := parseTerminalPoolSize(setting.Value)
	if err != nil {
		return DefaultTerminalPoolSize, fmt.Errorf("load terminal pool size: %w", err)
	}
	return value, nil
}

func parseTerminalPoolSize(raw string) (int, error) {
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	var decoded any
	if err := decoder.Decode(&decoded); err != nil {
		return 0, fmt.Errorf("invalid numeric value: %w", err)
	}
	number, ok := decoded.(json.Number)
	if !ok {
		return 0, fmt.Errorf("pool size must be a number")
	}
	parsed, err := strconv.ParseFloat(number.String(), 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) || parsed < 1 {
		return 0, fmt.Errorf("pool size must be a finite positive number")
	}
	maxInt := int(^uint(0) >> 1)
	if parsed > float64(maxInt) {
		return 0, fmt.Errorf("pool size exceeds platform limit")
	}
	return int(math.Floor(parsed)), nil
}
