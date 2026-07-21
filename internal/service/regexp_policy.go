package service

import (
	"fmt"
	"regexp"
	"strings"
)

const (
	maxUserRegexpLength = 256
	maxUserRegexpDepth  = 8
)

func validateUserRegexp(expression string) error {
	if expression == "" {
		return fmt.Errorf("regular expression is empty")
	}
	if len(expression) > maxUserRegexpLength {
		return fmt.Errorf("regular expression exceeds %d characters", maxUserRegexpLength)
	}
	if strings.Count(expression, "(") > maxUserRegexpDepth {
		return fmt.Errorf("regular expression nesting is too deep")
	}
	// Reject common catastrophic backtracking constructs.
	if strings.Contains(expression, "(.*)*") || strings.Contains(expression, "(.+)+") || strings.Contains(expression, "(a+)+") {
		return fmt.Errorf("regular expression contains unsafe nested quantifiers")
	}
	if _, err := regexp.Compile(expression); err != nil {
		return err
	}
	return nil
}
