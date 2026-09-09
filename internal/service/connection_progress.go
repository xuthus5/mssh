package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/xuthus5/mssh/pkg/event"
)

type connectionRequestContextKey struct{}

type jumpHostVerificationContextKey struct{}

type jumpHostRouteContextKey struct{}

const connectionRequestIDLimit = 128

func withConnectionRequest(ctx context.Context, requestID string) (context.Context, error) {
	if requestID == "" || len(requestID) > connectionRequestIDLimit || strings.IndexFunc(requestID, invalidConnectionRequestRune) >= 0 {
		return nil, fmt.Errorf("invalid connection request id")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, connectionRequestContextKey{}, requestID), nil
}

func invalidConnectionRequestRune(value rune) bool {
	return !strings.ContainsRune("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_", value)
}

func connectionRequestID(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	requestID, _ := ctx.Value(connectionRequestContextKey{}).(string)
	return requestID
}

func isJumpHostVerification(ctx context.Context) bool {
	jump, _ := ctx.Value(jumpHostVerificationContextKey{}).(bool)
	return jump
}

func usesJumpHost(ctx context.Context) bool {
	jump, _ := ctx.Value(jumpHostRouteContextKey{}).(bool)
	return jump || isJumpHostVerification(ctx)
}

func (s *SessionService) emitConnectionProgress(ctx context.Context, attemptID, stage string) {
	requestID := connectionRequestID(ctx)
	if requestID == "" {
		return
	}
	s.eventBus.Emit(event.ConnectionProgress, event.ConnectionProgressPayload{RequestID: requestID, AttemptID: attemptID, Stage: stage})
}
