package service

func (s *SecurityService) setDEK(dek []byte) error {
	if s.runtime == nil {
		return ErrVaultLocked
	}
	return s.runtime.WithCryptoOperation(func() error {
		s.runtime.SetDEK(dek)
		return nil
	})
}

func (s *SecurityService) clearDEK() error {
	if s.runtime == nil {
		return nil
	}
	return s.runtime.WithCryptoOperation(func() error {
		s.runtime.Clear()
		return nil
	})
}
