package service

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
	"github.com/xuthus5/mssh/internal/themeimport"
)

const maxThemeImportBytes = 2 << 20

func (service *ThemeService) ImportFiles(paths []string) (model.ThemeImportSummary, error) {
	summary := model.ThemeImportSummary{Results: make([]model.ThemeImportResult, 0, len(paths))}
	importers := []themeimport.ThemeImporter{themeimport.NewITermColorsImporter()}
	for _, path := range paths {
		summary.Results = append(summary.Results, service.importThemeFile(path, importers))
	}
	return summary, nil
}

func (service *ThemeService) importThemeFile(path string, importers []themeimport.ThemeImporter) model.ThemeImportResult {
	result := model.ThemeImportResult{File: path}
	content, err := os.ReadFile(path)
	if err != nil {
		return failedImport(result, fmt.Errorf("read theme file: %w", err))
	}
	if len(content) > maxThemeImportBytes {
		return failedImport(result, fmt.Errorf("theme file exceeds 2 MiB limit"))
	}
	importer := selectThemeImporter(importers, path, content)
	if importer == nil {
		return failedImport(result, fmt.Errorf("unsupported theme format %s", filepath.Ext(path)))
	}
	definitions, err := importer.Import(path, content)
	if err != nil {
		return failedImport(result, err)
	}
	if len(definitions) != 1 {
		return failedImport(result, fmt.Errorf("theme importer returned %d definitions", len(definitions)))
	}
	result.Name = definitions[0].Name
	if existing := service.definitionByFingerprint(definitions[0].SourceFingerprint); existing != nil {
		result.Status = model.ThemeImportDuplicate
		result.DefinitionID = existing.ID
		return result
	}
	return service.persistImportedTheme(result, definitions[0])
}

func (service *ThemeService) persistImportedTheme(result model.ThemeImportResult, definition model.ThemeDefinition) model.ThemeImportResult {
	tx, err := service.db.Begin()
	if err != nil {
		return failedImport(result, fmt.Errorf("begin theme import: %w", err))
	}
	createdDefinition, err := store.CreateThemeDefinition(tx, definition)
	if err != nil {
		_ = tx.Rollback()
		return failedImport(result, err)
	}
	profile, err := store.CreateThemeProfile(tx, model.ThemeProfile{Name: definition.Name, ThemeID: createdDefinition.ID, FontFamily: defaultTerminalFont, FontSize: 14, CursorStyle: model.CursorStyleBar, ColorOverrides: `{}`})
	if err != nil {
		_ = tx.Rollback()
		return failedImport(result, err)
	}
	if err = tx.Commit(); err != nil {
		return failedImport(result, fmt.Errorf("commit theme import: %w", err))
	}
	result.Status = model.ThemeImportImported
	result.DefinitionID = createdDefinition.ID
	result.ProfileID = profile.ID
	return result
}

func (service *ThemeService) definitionByFingerprint(fingerprint string) *model.ThemeDefinition {
	definitions, err := store.ListThemeDefinitions(service.db, "")
	if err != nil {
		return nil
	}
	for index := range definitions {
		if definitions[index].SourceFingerprint == fingerprint {
			return &definitions[index]
		}
	}
	return nil
}

func selectThemeImporter(importers []themeimport.ThemeImporter, path string, content []byte) themeimport.ThemeImporter {
	for _, importer := range importers {
		if importer.Supports(path, content) {
			return importer
		}
	}
	return nil
}

func failedImport(result model.ThemeImportResult, err error) model.ThemeImportResult {
	result.Status = model.ThemeImportFailed
	result.Error = err.Error()
	return result
}
