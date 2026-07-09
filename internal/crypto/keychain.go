package crypto

type KeychainAdapter interface {
	Get(service, account string) ([]byte, error)
	Set(service, account string, data []byte) error
	Delete(service, account string) error
	IsAvailable() bool
}
