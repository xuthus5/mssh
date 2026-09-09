package service

import (
	"context"

	"github.com/xuthus5/mssh/internal/model"
)

// OpenWithProgress 为此次打开操作绑定进度标识，避免并发会话串用连接状态。
func (t *TerminalService) OpenWithProgress(ctx context.Context, request model.SSHOpenRequest) (string, error) {
	progressContext, err := withConnectionRequest(ctx, request.RequestID)
	if err != nil {
		return "", err
	}
	return t.Open(progressContext, request.SessionID, request.Cols, request.Rows)
}
