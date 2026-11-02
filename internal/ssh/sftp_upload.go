package ssh

import (
	"context"
	"io"

	"github.com/pkg/sftp"
)

type uploadProgressReader struct {
	ctx        context.Context
	src        io.Reader
	total      int64
	read       int64
	onProgress ProgressFn
}

func (reader *uploadProgressReader) Read(data []byte) (int, error) {
	if err := reader.ctx.Err(); err != nil {
		return 0, err
	}
	readCount, err := reader.src.Read(data)
	if readCount > 0 {
		reader.read += int64(readCount)
		if reader.onProgress != nil {
			reader.onProgress(reader.read, reader.total)
		}
	}
	if ctxErr := reader.ctx.Err(); ctxErr != nil {
		return readCount, ctxErr
	}
	return readCount, err
}

func copyUploadedFile(
	ctx context.Context, remote *sftp.File, local io.Reader, total int64, onProgress ProgressFn,
) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	progressReader := &uploadProgressReader{
		ctx: ctx, src: local, total: total, onProgress: onProgress,
	}
	// ReadFromWithConcurrency pipelines multiple SFTP writes, avoiding the
	// per-packet RTT limit of calling Write repeatedly on high-latency links.
	_, err := remote.ReadFromWithConcurrency(progressReader, transferSFTPRequestThreads)
	if ctxErr := ctx.Err(); ctxErr != nil {
		return ctxErr
	}
	if err != nil {
		return err
	}
	return nil
}
