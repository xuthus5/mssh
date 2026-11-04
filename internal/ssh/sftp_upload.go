package ssh

import (
	"context"
	"errors"
	"io"
	"sync"

	"github.com/pkg/sftp"
)

type uploadChunk struct {
	data   []byte
	offset int64
}

type uploadProgress struct {
	mu         sync.Mutex
	written    int64
	total      int64
	onProgress ProgressFn
}

type uploadWorker struct {
	ctx      context.Context
	remote   *sftp.File
	jobs     <-chan uploadChunk
	progress *uploadProgress
	cancel   context.CancelFunc
	errOnce  sync.Once
	err      error
}

func (progress *uploadProgress) add(written int64) {
	progress.mu.Lock()
	defer progress.mu.Unlock()
	progress.written += written
	if progress.onProgress != nil {
		progress.onProgress(progress.written, progress.total)
	}
}

func copyUploadedFile(
	ctx context.Context, remote *sftp.File, local io.Reader, total int64, onProgress ProgressFn,
) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	uploadCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	jobs := make(chan uploadChunk)
	progress := &uploadProgress{total: total, onProgress: onProgress}
	worker := &uploadWorker{
		ctx: uploadCtx, remote: remote, jobs: jobs, progress: progress, cancel: cancel,
	}
	var workers sync.WaitGroup
	workers.Add(transferSFTPRequestThreads)
	for range transferSFTPRequestThreads {
		go func() {
			defer workers.Done()
			worker.run()
		}()
	}
	readErr := streamUploadChunks(uploadCtx, local, jobs)
	close(jobs)
	workers.Wait()
	if worker.err != nil {
		return worker.err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return readErr
}

func (worker *uploadWorker) run() {
	for chunk := range worker.jobs {
		if worker.ctx.Err() != nil {
			continue
		}
		// Report progress only after the server acknowledges the write.
		written, err := worker.remote.WriteAt(chunk.data, chunk.offset)
		if written > 0 {
			worker.progress.add(int64(written))
		}
		if err == nil && written == len(chunk.data) {
			continue
		}
		if err == nil {
			err = io.ErrShortWrite
		}
		worker.errOnce.Do(func() {
			worker.err = err
			worker.cancel()
		})
	}
}

func streamUploadChunks(ctx context.Context, local io.Reader, jobs chan<- uploadChunk) error {
	offset := int64(0)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		data := make([]byte, transferSFTPPacketSize)
		readCount, err := io.ReadFull(local, data)
		if readCount > 0 {
			select {
			case jobs <- uploadChunk{data: data[:readCount], offset: offset}:
				offset += int64(readCount)
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				return nil
			}
			return err
		}
	}
}
