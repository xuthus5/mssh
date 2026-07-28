package service

import (
	"fmt"

	"github.com/xuthus5/mssh/internal/model"
)

func validateSnapshotSessions(rows []map[string]any) error {
	seen := make(map[int64]struct{}, len(rows))
	for index, row := range rows {
		session, err := snapshotSessionFromRow(row)
		if err != nil {
			return fmt.Errorf("table sessions row %d: %w", index, err)
		}
		if _, duplicate := seen[session.ID]; duplicate {
			return fmt.Errorf("table sessions row %d: duplicate session id %d", index, session.ID)
		}
		if err := validateSnapshotSession(session); err != nil {
			return fmt.Errorf("table sessions row %d: %w", index, err)
		}
		seen[session.ID] = struct{}{}
	}
	return nil
}

func validateSnapshotSession(session model.Session) error {
	if err := validateSessionAssetInput(model.SessionInputFrom(session), true); err != nil {
		return err
	}
	if err := validateStoredSessionPassword(session.Password); err != nil {
		return err
	}
	if session.ConnectionCount < 0 {
		return fmt.Errorf("connection_count must not be negative")
	}
	return nil
}

func snapshotSessionFromRow(row map[string]any) (model.Session, error) {
	var session model.Session
	readers := []func() error{
		func() error { return readSnapshotSessionIdentity(row, &session) },
		func() error { return readSnapshotSessionAssets(row, &session) },
		func() error { return readSnapshotSessionAuthentication(row, &session) },
		func() error { return readSnapshotSessionRuntime(row, &session) },
		func() error { return readSnapshotSessionTimes(row, &session) },
	}
	for _, read := range readers {
		if err := read(); err != nil {
			return model.Session{}, err
		}
	}
	return session, nil
}

func readSnapshotSessionIdentity(row map[string]any, session *model.Session) error {
	var err error
	if session.ID, err = snapshotInt64Field(row, "id"); err != nil {
		return err
	}
	if session.FolderID, err = snapshotNullableInt64Field(row, "folder_id"); err != nil {
		return err
	}
	if session.Name, err = snapshotStringField(row, "name"); err != nil {
		return err
	}
	if session.Host, err = snapshotStringField(row, "host"); err != nil {
		return err
	}
	if session.Port, err = snapshotIntField(row, "port"); err != nil {
		return err
	}
	if session.Username, err = snapshotStringField(row, "username"); err != nil {
		return err
	}
	session.Notes, err = snapshotStringField(row, "notes")
	return err
}

func readSnapshotSessionAssets(row map[string]any, session *model.Session) error {
	var err error
	if session.EnvironmentID, err = snapshotNullableInt64Field(row, "environment_id"); err != nil {
		return err
	}
	if session.ProjectID, err = snapshotNullableInt64Field(row, "project_id"); err != nil {
		return err
	}
	session.KeyID, err = snapshotNullableInt64Field(row, "key_id")
	return err
}

func readSnapshotSessionAuthentication(row map[string]any, session *model.Session) error {
	authMethod, err := snapshotStringField(row, "auth_method")
	if err != nil {
		return err
	}
	session.AuthMethod = model.AuthMethod(authMethod)
	if session.Password, err = snapshotNullableStringField(row, "password"); err != nil {
		return err
	}
	if session.KeepAlive, err = snapshotIntField(row, "keep_alive"); err != nil {
		return err
	}
	session.TermType, err = snapshotStringField(row, "term_type")
	return err
}

func readSnapshotSessionRuntime(row map[string]any, session *model.Session) error {
	var err error
	if session.SortOrder, err = snapshotIntField(row, "sort_order"); err != nil {
		return err
	}
	if session.LastConnectedAt, err = snapshotNullableTimeField(row, "last_connected_at"); err != nil {
		return err
	}
	session.ConnectionCount, err = snapshotIntField(row, "connection_count")
	return err
}

func readSnapshotSessionTimes(row map[string]any, session *model.Session) error {
	var err error
	if session.CreatedAt, err = snapshotTimeField(row, "created_at"); err != nil {
		return err
	}
	session.UpdatedAt, err = snapshotTimeField(row, "updated_at")
	return err
}
