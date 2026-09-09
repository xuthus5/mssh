package service

import (
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
)

const snapshotDefaultJumpPort = 22

func readSnapshotSessionJumpHost(row map[string]any, session *model.Session) error {
	fields := []string{"jump_host", "jump_port", "jump_username", "jump_auth_method", "jump_password", "jump_key_id"}
	present := false
	for _, field := range fields {
		if _, exists := row[field]; exists {
			present = true
		}
	}
	if !present {
		return nil // 旧备份没有跳板列，保持直连。
	}
	jump, err := snapshotSSHJumpHostFromRow(row)
	if err != nil {
		return err
	}
	if jump.Host == "" {
		return validateDisabledSnapshotJumpHost(jump)
	}
	session.JumpHost = jump
	return nil
}

func validateDisabledSnapshotJumpHost(jump *model.SSHJumpHost) error {
	if jump.Username != "" || jump.Password != "" || jump.KeyID != nil || jump.Port != snapshotDefaultJumpPort || jump.AuthMethod != model.AuthPassword {
		return fmt.Errorf("disabled SSH jump host must not contain connection settings or credentials")
	}
	return nil
}

func snapshotSSHJumpHostFromRow(row map[string]any) (*model.SSHJumpHost, error) {
	jump := &model.SSHJumpHost{}
	var err error
	if jump.Host, err = snapshotStringField(row, "jump_host"); err != nil {
		return nil, err
	}
	if jump.Port, err = snapshotIntField(row, "jump_port"); err != nil {
		return nil, err
	}
	if jump.Username, err = snapshotStringField(row, "jump_username"); err != nil {
		return nil, err
	}
	method, err := snapshotStringField(row, "jump_auth_method")
	if err != nil {
		return nil, err
	}
	jump.AuthMethod = model.AuthMethod(method)
	if jump.Password, err = snapshotStringField(row, "jump_password"); err != nil {
		return nil, err
	}
	if jump.KeyID, err = snapshotNullableInt64Field(row, "jump_key_id"); err != nil {
		return nil, err
	}
	return jump, nil
}
