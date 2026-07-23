package service

import "errors"

type staticPasswordVerifier string

func (v staticPasswordVerifier) VerifyPassword(password string) error {
	if password != string(v) {
		return errors.New("invalid application password")
	}
	return nil
}
