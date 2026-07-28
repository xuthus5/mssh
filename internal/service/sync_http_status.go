package service

import "net/http"

func isCompletedSyncUploadStatus(status int) bool {
	switch status {
	case http.StatusOK, http.StatusCreated, http.StatusNoContent:
		return true
	default:
		return false
	}
}
