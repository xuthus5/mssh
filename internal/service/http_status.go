package service

import (
	"fmt"
	"net/http"
)

func expectHTTPStatus(response *http.Response, expected int, action string) error {
	if response.StatusCode != expected {
		return fmt.Errorf("%s returned %s", action, response.Status)
	}
	return nil
}
