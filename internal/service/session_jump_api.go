package service

import (
	"context"
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
)

// TestSSHJumpHost 只验证跳板机登录，不保存草稿，也不创建目标终端或端口转发。
func (s *SessionService) TestSSHJumpHost(ctx context.Context, input model.SSHJumpHostTestInput) error {
	finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	progressContext, err := withConnectionRequest(ctx, input.RequestID)
	if err != nil {
		return err
	}
	jump, err := s.jumpHostForTest(input)
	if err != nil {
		return err
	}
	session := &model.Session{ID: input.SessionID, JumpHost: jump, KeepAlive: s.keepAlive}
	client, cleanup, err := s.openJumpHost(progressContext, session, nil)
	if err != nil {
		return err
	}
	if err := closeRejectedConnection(client, cleanup); err != nil {
		return fmt.Errorf("close SSH jump host test: %w", err)
	}
	return nil
}
