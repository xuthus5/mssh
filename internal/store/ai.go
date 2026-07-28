package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

func ListAIProviderProfiles(db *sql.DB) ([]model.AIProviderProfile, error) {
	rows, err := db.Query(`SELECT id, name, provider, base_url, default_model, enabled, context_window_size, skip_tls_verify, max_tokens, temperature, top_p, frequency_penalty, presence_penalty, custom_headers, created_at, updated_at FROM ai_provider_profiles ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("list ai provider profiles: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]model.AIProviderProfile, 0)
	for rows.Next() {
		profile, scanErr := scanAIProviderProfile(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, profile)
	}
	return result, rows.Err()
}

func GetAIProviderProfile(db *sql.DB, id int64) (*model.AIProviderProfile, error) {
	profile, err := scanAIProviderProfile(db.QueryRow(`SELECT id, name, provider, base_url, default_model, enabled, context_window_size, skip_tls_verify, max_tokens, temperature, top_p, frequency_penalty, presence_penalty, custom_headers, created_at, updated_at FROM ai_provider_profiles WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &profile, nil
}

func SaveAIProviderProfile(db *sql.DB, input model.AIProviderProfileInput) (*model.AIProviderProfile, error) {
	if input.ID == 0 {
		customHeadersJSON, _ := json.Marshal(input.CustomHeaders)
		result, err := db.Exec(`INSERT INTO ai_provider_profiles (name, provider, base_url, default_model, enabled, context_window_size, skip_tls_verify, max_tokens, temperature, top_p, frequency_penalty, presence_penalty, custom_headers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, input.Name, input.Provider, input.BaseURL, input.DefaultModel, input.Enabled, input.ContextWindowSize, input.SkipTLSVerify, input.MaxTokens, input.Temperature, input.TopP, input.FrequencyPenalty, input.PresencePenalty, string(customHeadersJSON))
		if err != nil {
			return nil, fmt.Errorf("create ai provider profile: %w", err)
		}
		input.ID, err = result.LastInsertId()
		if err != nil {
			return nil, fmt.Errorf("create ai provider profile id: %w", err)
		}
	} else {
		customHeadersJSON, _ := json.Marshal(input.CustomHeaders)
		result, err := db.Exec(`UPDATE ai_provider_profiles SET name=?, provider=?, base_url=?, default_model=?, enabled=?, context_window_size=?, skip_tls_verify=?, max_tokens=?, temperature=?, top_p=?, frequency_penalty=?, presence_penalty=?, custom_headers=?, updated_at=datetime('now') WHERE id=?`, input.Name, input.Provider, input.BaseURL, input.DefaultModel, input.Enabled, input.ContextWindowSize, input.SkipTLSVerify, input.MaxTokens, input.Temperature, input.TopP, input.FrequencyPenalty, input.PresencePenalty, string(customHeadersJSON), input.ID)
		if err != nil {
			return nil, fmt.Errorf("update ai provider profile: %w", err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return nil, fmt.Errorf("check ai provider profile update: %w", err)
		}
		if affected == 0 {
			return nil, fmt.Errorf("ai provider profile %d not found", input.ID)
		}
	}
	return GetAIProviderProfile(db, input.ID)
}

func DeleteAIProviderProfile(db *sql.DB, id int64) error {
	result, err := db.Exec("DELETE FROM ai_provider_profiles WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete ai provider profile: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check ai provider profile delete: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("ai provider profile %d not found", id)
	}
	return nil
}

func scanAIProviderProfile(scanner settingScanner) (model.AIProviderProfile, error) {
	var profile model.AIProviderProfile
	var createdAt, updatedAt string
	var customHeadersJSON string
	var temperature, topP, frequencyPenalty, presencePenalty sql.NullFloat64
	if err := scanner.Scan(&profile.ID, &profile.Name, &profile.Provider, &profile.BaseURL, &profile.DefaultModel, &profile.Enabled, &profile.ContextWindowSize, &profile.SkipTLSVerify, &profile.MaxTokens, &temperature, &topP, &frequencyPenalty, &presencePenalty, &customHeadersJSON, &createdAt, &updatedAt); err != nil {
		return model.AIProviderProfile{}, err
	}
	if temperature.Valid {
		profile.Temperature = &temperature.Float64
	}
	if topP.Valid {
		profile.TopP = &topP.Float64
	}
	if frequencyPenalty.Valid {
		profile.FrequencyPenalty = &frequencyPenalty.Float64
	}
	if presencePenalty.Valid {
		profile.PresencePenalty = &presencePenalty.Float64
	}
	if customHeadersJSON != "" {
		_ = json.Unmarshal([]byte(customHeadersJSON), &profile.CustomHeaders)
	}
	var err error
	profile.CreatedAt, err = time.Parse("2006-01-02 15:04:05", createdAt)
	if err != nil {
		return model.AIProviderProfile{}, fmt.Errorf("parse ai provider created_at: %w", err)
	}
	profile.UpdatedAt, err = time.Parse("2006-01-02 15:04:05", updatedAt)
	if err != nil {
		return model.AIProviderProfile{}, fmt.Errorf("parse ai provider updated_at: %w", err)
	}
	return profile, nil
}

func LoadAISettings(db *sql.DB, defaults model.AISettings) (model.AISettings, error) {
	var interactionJSON, searchJSON, securityJSON string
	settings := defaults
	err := db.QueryRow(`SELECT default_provider_id, fallback_provider_id, interaction_json, search_json, security_json FROM ai_settings WHERE id = 1`).Scan(
		&settings.DefaultProviderID, &settings.FallbackProviderID, &interactionJSON, &searchJSON, &securityJSON,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return defaults, nil
	}
	if err != nil {
		return model.AISettings{}, fmt.Errorf("load ai settings: %w", err)
	}
	if err := json.Unmarshal([]byte(interactionJSON), &settings.Interaction); err != nil {
		return model.AISettings{}, fmt.Errorf("decode ai interaction settings: %w", err)
	}
	if err := json.Unmarshal([]byte(searchJSON), &settings.Search); err != nil {
		return model.AISettings{}, fmt.Errorf("decode ai search settings: %w", err)
	}
	if err := json.Unmarshal([]byte(securityJSON), &settings.Security); err != nil {
		return model.AISettings{}, fmt.Errorf("decode ai security settings: %w", err)
	}
	return settings, nil
}

func SaveAISettings(db *sql.DB, settings model.AISettings) error {
	return saveAISettings(db, settings)
}

func SaveAISettingsAndPrune(db *sql.DB, settings model.AISettings) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin AI settings transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := saveAISettings(tx, settings); err != nil {
		return err
	}
	if err := pruneAIConversations(tx, settings.Interaction.HistoryRetentionDays, settings.Interaction.MaxConversations); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit AI settings transaction: %w", err)
	}
	return nil
}

type aiExecer interface {
	Exec(query string, args ...any) (sql.Result, error)
}

func saveAISettings(execer aiExecer, settings model.AISettings) error {
	interactionJSON, err := json.Marshal(settings.Interaction)
	if err != nil {
		return fmt.Errorf("encode ai interaction settings: %w", err)
	}
	searchJSON, err := json.Marshal(settings.Search)
	if err != nil {
		return fmt.Errorf("encode ai search settings: %w", err)
	}
	securityJSON, err := json.Marshal(settings.Security)
	if err != nil {
		return fmt.Errorf("encode ai security settings: %w", err)
	}
	_, err = execer.Exec(`INSERT INTO ai_settings (id, default_provider_id, fallback_provider_id, interaction_json, search_json, security_json, updated_at) VALUES (1, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET default_provider_id=excluded.default_provider_id, fallback_provider_id=excluded.fallback_provider_id, interaction_json=excluded.interaction_json, search_json=excluded.search_json, security_json=excluded.security_json, updated_at=datetime('now')`, settings.DefaultProviderID, settings.FallbackProviderID, interactionJSON, searchJSON, securityJSON)
	if err != nil {
		return fmt.Errorf("save ai settings: %w", err)
	}
	return nil
}
