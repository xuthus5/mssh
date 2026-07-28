package service

import (
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
)

func (s *SessionService) decryptSessionPasswordsForExport(sessions []model.Session) ([]model.Session, error) {
	out := make([]model.Session, len(sessions))
	copy(out, sessions)
	for i := range out {
		if out[i].Password == "" {
			continue
		}
		plain, err := openSessionPassword(s.crypto, out[i].Password)
		if err != nil {
			return nil, fmt.Errorf("decrypt session %d password: %w", out[i].ID, err)
		}
		out[i].Password = plain
	}
	return out, nil
}

func (s *SessionService) requireExportPasswordConfirmation(password string) error {
	if s.passwords == nil {
		return fmt.Errorf("export with passwords requires application password verification")
	}
	if err := s.passwords.VerifyPassword(password); err != nil {
		return fmt.Errorf("confirm application password: %w", err)
	}
	return nil
}
