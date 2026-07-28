package service

import "github.com/xuthus5/mssh/internal/model"

func (s *SecurityService) SavePreferences(input model.SecurityPreferenceInput) (model.SecurityStatus, error) {
	finish, err := s.beginOperation()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	defer finish()
	s.stateMu.Lock()
	status, err := s.savePreferencesLocked(input)
	s.stateMu.Unlock()
	if err != nil {
		return model.SecurityStatus{}, err
	}
	s.emitVaultStatus(status)
	return status, nil
}

func (s *SecurityService) savePreferencesLocked(input model.SecurityPreferenceInput) (model.SecurityStatus, error) {
	var dek []byte
	if input.RememberUnlock && !input.RequirePasswordOnLaunch && s.runtimeUnlocked() {
		loaded, err := s.runtime.DEK()
		if err != nil {
			return model.SecurityStatus{}, err
		}
		dek = loaded
		defer clear(dek)
	}
	if err := s.configureUnlockPreferences(input.RequirePasswordOnLaunch, input.RememberUnlock, dek); err != nil {
		return model.SecurityStatus{}, err
	}
	return s.statusLocked()
}
