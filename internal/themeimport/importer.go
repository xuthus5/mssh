package themeimport

import "github.com/xuthus5/mssh/internal/model"

type ThemeImporter interface {
	Supports(filename string, content []byte) bool
	Import(filename string, content []byte) ([]model.ThemeDefinition, error)
}
