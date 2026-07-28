package service

import (
	"database/sql"
	"fmt"
	"log/slog"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const defaultTerminalFont = model.DefaultTerminalFontFamily

type ThemeService struct {
	db        *sql.DB
	logger    *slog.Logger
	lifecycle serviceOperationGate
}

type themeDatabase interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

func NewThemeService(db *sql.DB, logger *slog.Logger) *ThemeService {
	return &ThemeService{db: db, logger: logger}
}

func (service *ThemeService) ListDefinitions(mode string) ([]model.ThemeDefinition, error) {
	finish, err := service.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	parsed, err := parseThemeMode(mode)
	if err != nil {
		return nil, err
	}
	return store.ListThemeDefinitions(service.db, parsed)
}

func (service *ThemeService) ListProfiles(mode string) ([]model.ThemeProfile, error) {
	finish, err := service.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	parsed, err := parseThemeMode(mode)
	if err != nil {
		return nil, err
	}
	return store.ListThemeProfiles(service.db, parsed)
}

func (service *ThemeService) GetProfile(id int64) (*model.ThemeProfile, error) {
	finish, err := service.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	if id <= 0 {
		return nil, fmt.Errorf("invalid theme profile id")
	}
	return store.GetThemeProfile(service.db, id)
}

func (service *ThemeService) CreateCustomProfile(input model.ThemeProfileInput) (*model.ThemeProfile, error) {
	finish, err := service.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	profile := normalizeThemeProfile(input.ThemeProfile())
	profile.FollowGlobalStyle = true
	if err := validateThemeProfile(profile); err != nil {
		return nil, err
	}
	return store.CreateThemeProfile(service.db, profile)
}

func (service *ThemeService) UpdateProfile(input model.ThemeProfileInput) error {
	finish, err := service.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	if input.ID <= 0 {
		return fmt.Errorf("invalid theme profile id")
	}
	profile := normalizeThemeProfile(input.ThemeProfile())
	if err := validateThemeProfile(profile); err != nil {
		return err
	}
	return store.UpdateThemeProfile(service.db, profile)
}

func (service *ThemeService) DeleteProfile(id int64) error {
	finish, err := service.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	if id <= 0 {
		return fmt.Errorf("invalid theme profile id")
	}
	tx, err := service.db.Begin()
	if err != nil {
		return fmt.Errorf("begin delete theme profile: %w", err)
	}
	if err = store.DeleteThemeProfile(tx, id); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("delete theme profile: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit delete theme profile: %w", err)
	}
	return nil
}

func (service *ThemeService) DeleteDefinition(id int64) error {
	finish, err := service.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	if id <= 0 {
		return fmt.Errorf("invalid theme definition id")
	}
	return store.DeleteThemeDefinition(service.db, id)
}

func (service *ThemeService) GetAssignments() (model.ThemeAssignments, error) {
	finish, err := service.beginOperation()
	if err != nil {
		return model.ThemeAssignments{}, err
	}
	defer finish()
	if err = service.initializeDefaults(); err != nil {
		return model.ThemeAssignments{}, err
	}
	return store.GetThemeAssignments(service.db)
}

func (service *ThemeService) GetGlobalStyle() (model.TerminalGlobalStyle, error) {
	finish, err := service.beginOperation()
	if err != nil {
		return model.TerminalGlobalStyle{}, err
	}
	defer finish()
	if err = service.initializeDefaults(); err != nil {
		return model.TerminalGlobalStyle{}, err
	}
	return store.GetTerminalGlobalStyle(service.db)
}

func (service *ThemeService) SaveAssignments(input model.ThemeAssignmentsInput) error {
	finish, err := service.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	assignments := input.ThemeAssignments()
	tx, err := service.db.Begin()
	if err != nil {
		return fmt.Errorf("begin save theme assignments: %w", err)
	}
	if _, err = loadValidatedThemeAssignments(tx); err == nil {
		err = validateThemeAssignments(tx, assignments)
	}
	if err == nil {
		err = store.SaveThemeAssignmentsDB(tx, assignments)
	}
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("save theme assignments: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit theme assignments: %w", err)
	}
	return nil
}

func (service *ThemeService) SaveConfiguration(input model.ThemeConfigurationInput) error {
	finish, err := service.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	tx, err := service.db.Begin()
	if err != nil {
		return fmt.Errorf("begin theme configuration: %w", err)
	}
	if err = validateStoredThemeConfiguration(tx); err == nil {
		var configuration validatedThemeConfiguration
		configuration, err = prepareThemeConfiguration(tx, input)
		if err == nil {
			err = saveThemeConfiguration(tx, configuration)
		}
	}
	if err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("save theme configuration: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit theme configuration: %w", err)
	}
	return nil
}
