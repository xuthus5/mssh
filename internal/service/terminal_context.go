package service

import (
	"context"
	"fmt"
)

func contextError(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("terminal open: %w", err)
	}
	return nil
}
