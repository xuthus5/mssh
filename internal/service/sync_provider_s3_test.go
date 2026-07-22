package service

import (
	"bytes"
	"context"
	"io"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	smithy "github.com/aws/smithy-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeS3SyncClient struct {
	content []byte
	etag    string
	key     string
	put     *s3.PutObjectInput
}

func (f *fakeS3SyncClient) HeadBucket(context.Context, *s3.HeadBucketInput, ...func(*s3.Options)) (*s3.HeadBucketOutput, error) {
	return &s3.HeadBucketOutput{}, nil
}

func (f *fakeS3SyncClient) GetObject(_ context.Context, input *s3.GetObjectInput, _ ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
	f.key = aws.ToString(input.Key)
	if f.content == nil {
		return nil, &smithy.GenericAPIError{Code: "NoSuchKey", Message: "missing"}
	}
	return &s3.GetObjectOutput{Body: io.NopCloser(bytes.NewReader(f.content)), ETag: aws.String(f.etag)}, nil
}

func (f *fakeS3SyncClient) PutObject(_ context.Context, input *s3.PutObjectInput, _ ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	f.put = input
	f.key = aws.ToString(input.Key)
	f.content, _ = io.ReadAll(input.Body)
	f.etag = `"v1"`
	return &s3.PutObjectOutput{ETag: aws.String(f.etag)}, nil
}

func TestS3ProviderUsesConditionalFixedObjectKey(t *testing.T) {
	client := &fakeS3SyncClient{}
	provider := &s3SyncProvider{client: client, bucket: "bucket", key: s3ObjectKey("mssh/backups")}
	require.NoError(t, provider.Test(t.Context()))
	_, err := provider.Fetch(t.Context())
	assert.ErrorIs(t, err, errSyncRemoteNotFound)
	_, err = provider.Put(t.Context(), []byte("backup"), "")
	require.NoError(t, err)
	assert.Equal(t, "mssh/backups/.msshbackup", client.key)
	assert.Equal(t, "*", aws.ToString(client.put.IfNoneMatch))
	remote, err := provider.Fetch(t.Context())
	require.NoError(t, err)
	assert.Equal(t, []byte("backup"), remote.Content)
	_, err = provider.Put(t.Context(), []byte("next"), `"v1"`)
	require.NoError(t, err)
	assert.Equal(t, `"v1"`, aws.ToString(client.put.IfMatch))
}
