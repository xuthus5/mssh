package crypto

type defaultKeychain struct{}

func (d *defaultKeychain) Get(_, _ string) ([]byte, error) { return nil, nil }

func (d *defaultKeychain) Set(_, _ string, _ []byte) error { return nil }

func (d *defaultKeychain) Delete(_, _ string) error { return nil }

func (d *defaultKeychain) IsAvailable() bool { return false }

func NewKeychainAdapter() KeychainAdapter {
	return &defaultKeychain{}
}
