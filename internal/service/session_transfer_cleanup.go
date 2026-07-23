package service

// SessionTransferCanceller cancels live SFTP transfers belonging to sessions about to be deleted.
type SessionTransferCanceller interface {
	CancelForSessions(sessionIDs []int64)
}

// SetTransferCanceller wires transfer cleanup before session rows are removed.
//
//wails:ignore
func (s *SessionService) SetTransferCanceller(canceller SessionTransferCanceller) {
	s.transfers = canceller
}

func (s *SessionService) cancelTransfersForSessions(sessionIDs []int64) {
	if s.transfers == nil || len(sessionIDs) == 0 {
		return
	}
	s.transfers.CancelForSessions(sessionIDs)
}
