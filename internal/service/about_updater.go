package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/updater"

	"github.com/xuthus5/mssh/internal/model"
)

const updateDownloadURLMetadata = "mssh.download_url"

type updateEngine interface {
	Check(context.Context) (*updater.Release, error)
	DownloadAndInstall(context.Context) error
	Restart(context.Context) error
}

type aboutUpdateProvider struct {
	service *AboutService
}

func NewAboutUpdateProvider(service *AboutService) updater.Provider {
	return &aboutUpdateProvider{service: service}
}

func (provider *aboutUpdateProvider) Name() string { return "mssh-github" }

func (provider *aboutUpdateProvider) Check(ctx context.Context, request updater.CheckRequest) (*updater.Release, error) {
	if provider.service == nil {
		return nil, fmt.Errorf("about service is required")
	}
	platform := request.Platform
	if platform == "" {
		platform = runtime.GOOS
	}
	arch := request.Arch
	if arch == "" {
		arch = runtime.GOARCH
	}
	release, err := provider.service.fetchLatestRelease(ctx, request.CurrentVersion, platform, arch, true)
	if err != nil {
		return nil, err
	}
	if !release.Info.UpdateAvailable {
		return nil, nil
	}
	out := &updater.Release{
		Version: release.Tag, Name: release.Tag, PublishedAt: release.PublishedAt,
		Artifact: updater.Artifact{
			Filename: release.Asset.Name, Filetype: release.Asset.ContentType,
			Size: release.Asset.Size, Platform: platform, Arch: arch,
		},
		Metadata: map[string]any{updateDownloadURLMetadata: release.Asset.BrowserDownloadURL},
	}
	if len(release.Digest) > 0 {
		out.Verification = &updater.Verification{DigestAlgo: "sha256", Digest: release.Digest}
	}
	return out, nil
}

func (provider *aboutUpdateProvider) Download(ctx context.Context, release *updater.Release, dst io.Writer, onProgress func(written, total int64)) error {
	if provider.service == nil {
		return fmt.Errorf("about service is required")
	}
	urlValue, ok := release.Metadata[updateDownloadURLMetadata].(string)
	if !ok || urlValue == "" {
		return fmt.Errorf("release download URL is missing")
	}
	if err := validateOutboundHTTPURL(urlValue); err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, urlValue, nil)
	if err != nil {
		return err
	}
	client := provider.service.downloadClient
	if client == nil {
		client = provider.service.client
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("download update returned %s", response.Status)
	}
	total := release.Artifact.Size
	if total == 0 {
		total = response.ContentLength
	}
	return copyUpdate(response.Body, dst, total, onProgress)
}

func copyUpdate(source io.Reader, destination io.Writer, total int64, onProgress func(int64, int64)) error {
	buffer := make([]byte, 64*1024)
	var written int64
	for {
		read, readErr := source.Read(buffer)
		if read > 0 {
			if _, writeErr := destination.Write(buffer[:read]); writeErr != nil {
				return writeErr
			}
			written += int64(read)
			if onProgress != nil {
				onProgress(written, total)
			}
		}
		if readErr == io.EOF {
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}

// SetUpdater connects the Wails updater. Called during application wiring.
//
//wails:ignore
func (a *AboutService) SetUpdater(engine updateEngine) {
	if a != nil {
		a.updater = engine
	}
}

func (a *AboutService) DownloadUpdate(ctx context.Context) (*model.UpdateInfo, error) {
	operationContext, finish, err := a.beginOperation(ctx)
	if err != nil {
		return nil, fmt.Errorf("download update: %w", err)
	}
	defer finish()
	if ready := a.ReadyUpdate(); ready != nil {
		return ready, nil
	}
	if a.updater == nil {
		return nil, fmt.Errorf("download update: updater is not configured")
	}
	release, err := a.updater.Check(operationContext)
	if err != nil {
		return nil, fmt.Errorf("download update: %w", err)
	}
	if release == nil {
		return &model.UpdateInfo{CurrentVersion: Version, LatestVersion: Version}, nil
	}
	if err := a.updater.DownloadAndInstall(operationContext); err != nil {
		return nil, fmt.Errorf("download update: %w", err)
	}
	info := updateInfoFromRelease(release)
	a.setReadyUpdate(info)
	a.notifyUpdateReady(info)
	return &info, nil
}

func updateInfoFromRelease(release *updater.Release) model.UpdateInfo {
	info := model.UpdateInfo{
		CurrentVersion: Version, LatestVersion: release.Version, UpdateAvailable: true,
		ArtifactName: release.Artifact.Filename, ArtifactSize: release.Artifact.Size,
	}
	if releaseURL, err := trustedReleaseURL(RepositoryURL+"/releases/tag/"+release.Version, release.Version); err == nil {
		info.ReleaseURL = releaseURL
	}
	return info
}

func (a *AboutService) setReadyUpdate(info model.UpdateInfo) {
	a.readyMu.Lock()
	a.readyUpdate = &info
	a.readyMu.Unlock()
}

func (a *AboutService) ReadyUpdate() *model.UpdateInfo {
	if a == nil {
		return nil
	}
	a.readyMu.Lock()
	defer a.readyMu.Unlock()
	if a.readyUpdate == nil {
		return nil
	}
	info := *a.readyUpdate
	return &info
}

func (a *AboutService) RestartUpdate(ctx context.Context) error {
	if a == nil || a.updater == nil {
		return fmt.Errorf("restart update: updater is not configured")
	}
	if ctx == nil {
		return fmt.Errorf("restart update: context is required")
	}
	return a.updater.Restart(ctx)
}
