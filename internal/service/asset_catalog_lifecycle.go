package service

import "errors"

var errAssetCatalogStopped = errors.New("asset catalog service is shutting down")

func (s *AssetCatalogService) beginOperation() (func(), error) {
	if s == nil {
		return nil, errAssetCatalogStopped
	}
	return s.lifecycle.begin(errAssetCatalogStopped)
}

// Shutdown rejects new asset catalog operations and waits for active calls.
//
//wails:ignore
func (s *AssetCatalogService) Shutdown() {
	if s == nil {
		return
	}
	s.lifecycle.stopAndWait()
}
