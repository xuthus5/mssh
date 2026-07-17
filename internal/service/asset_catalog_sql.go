package service

import (
	"database/sql"
	"fmt"
	"strings"
)

func countIDsQuery(table string, ids []int64) (string, []any) {
	query, arguments := inQuery("SELECT COUNT(*) FROM "+table+" WHERE id IN (", ids)
	return query, arguments
}

func updateIDsQuery(prefix string, first any, ids []int64) (string, []any) {
	query, idArguments := inQuery(prefix, ids)
	arguments := make([]any, 0, len(idArguments)+1)
	arguments = append(arguments, first)
	arguments = append(arguments, idArguments...)
	return query, arguments
}

func inQuery(prefix string, ids []int64) (string, []any) {
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	arguments := make([]any, len(ids))
	for index, id := range ids {
		arguments[index] = id
	}
	return prefix + placeholders + ")", arguments
}

func removeSessionTags(tx *sql.Tx, sessions, tags []int64) error {
	sessionPlaceholders := strings.TrimSuffix(strings.Repeat("?,", len(sessions)), ",")
	tagPlaceholders := strings.TrimSuffix(strings.Repeat("?,", len(tags)), ",")
	arguments := make([]any, 0, len(sessions)+len(tags))
	for _, id := range sessions {
		arguments = append(arguments, id)
	}
	for _, id := range tags {
		arguments = append(arguments, id)
	}
	query := "DELETE FROM session_tags WHERE session_id IN (" + sessionPlaceholders + ") AND tag_id IN (" + tagPlaceholders + ")"
	if _, err := tx.Exec(query, arguments...); err != nil {
		return fmt.Errorf("remove session tags: %w", err)
	}
	return nil
}

func insertSessionTags(tx *sql.Tx, sessions, tags []int64) error {
	placeholders := make([]string, 0, len(sessions)*len(tags))
	arguments := make([]any, 0, len(sessions)*len(tags)*2)
	for _, sessionID := range sessions {
		for _, tagID := range tags {
			placeholders = append(placeholders, "(?, ?)")
			arguments = append(arguments, sessionID, tagID)
		}
	}
	query := "INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES " + strings.Join(placeholders, ",")
	if _, err := tx.Exec(query, arguments...); err != nil {
		return fmt.Errorf("insert session tags: %w", err)
	}
	return nil
}
