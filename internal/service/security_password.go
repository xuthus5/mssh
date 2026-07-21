package service

import (
	"errors"
	"strings"
)

func sealSessionPassword(c KeyCrypto, plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	sealed, err := c.Encrypt([]byte(plain))
	if err != nil {
		return "", err
	}
	return sessionPasswordPrefix + string(sealed), nil
}

func openSessionPassword(c KeyCrypto, stored string) (string, error) {
	if stored == "" {
		return "", nil
	}
	if !strings.HasPrefix(stored, sessionPasswordPrefix) {
		// Fresh install policy stores only enc1; treat unexpected values as error.
		return "", errors.New("session password is not encrypted with application vault")
	}
	plain, err := c.Decrypt([]byte(strings.TrimPrefix(stored, sessionPasswordPrefix)))
	if err != nil {
		return "", err
	}
	return string(plain), nil
}
