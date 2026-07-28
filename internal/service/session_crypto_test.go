package service

func newUnlockedSessionTestCrypto() *CryptoRuntime {
	runtime := NewCryptoRuntime()
	dek := make([]byte, 32)
	for index := range dek {
		dek[index] = byte(index + 1)
	}
	runtime.SetDEK(dek)
	return runtime
}
