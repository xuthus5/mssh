package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"

	"github.com/xuthus5/mssh/internal/model"
)

type s3SyncClient interface {
	HeadBucket(context.Context, *s3.HeadBucketInput, ...func(*s3.Options)) (*s3.HeadBucketOutput, error)
	GetObject(context.Context, *s3.GetObjectInput, ...func(*s3.Options)) (*s3.GetObjectOutput, error)
	PutObject(context.Context, *s3.PutObjectInput, ...func(*s3.Options)) (*s3.PutObjectOutput, error)
}

type s3SyncProvider struct {
	client s3SyncClient
	bucket string
	key    string
}

func newS3SyncProvider(ctx context.Context, config model.S3SyncConfig, secretKey string) (*s3SyncProvider, error) {
	credentialsProvider := credentials.NewStaticCredentialsProvider(config.AccessKeyID, secretKey, "")
	awsConfig, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(config.Region), awsconfig.WithCredentialsProvider(credentialsProvider))
	if err != nil {
		return nil, fmt.Errorf("load S3 configuration: %w", err)
	}
	client := s3.NewFromConfig(awsConfig, func(options *s3.Options) {
		options.UsePathStyle = config.PathStyle
		if config.Endpoint != "" {
			options.BaseEndpoint = aws.String(config.Endpoint)
		}
	})
	return &s3SyncProvider{client: client, bucket: config.Bucket, key: s3ObjectKey(config.Prefix)}, nil
}

func s3ObjectKey(prefix string) string {
	prefix = strings.Trim(prefix, "/")
	if prefix == "" {
		return syncBackupFileName
	}
	return prefix + "/" + syncBackupFileName
}

func (s *s3SyncProvider) Test(ctx context.Context) error {
	_, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(s.bucket)})
	if err != nil {
		return fmt.Errorf("S3 connection: %w", err)
	}
	return nil
}

func (s *s3SyncProvider) Fetch(ctx context.Context) (syncRemoteObject, error) {
	response, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(s.key)})
	if err != nil {
		if s3ErrorCode(err) == "NoSuchKey" || s3ErrorCode(err) == "NotFound" {
			return syncRemoteObject{}, errSyncRemoteNotFound
		}
		return syncRemoteObject{}, fmt.Errorf("S3 download: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	content, err := readCloudBackup(response.Body)
	if err != nil {
		return syncRemoteObject{}, err
	}
	return syncRemoteObject{Content: content, ETag: aws.ToString(response.ETag)}, nil
}

func (s *s3SyncProvider) Put(ctx context.Context, content []byte, etag string) (syncRemoteObject, error) {
	input := &s3.PutObjectInput{
		Bucket: aws.String(s.bucket), Key: aws.String(s.key), Body: bytes.NewReader(content),
		ContentType: aws.String("application/json; charset=utf-8"),
	}
	if etag == "" {
		input.IfNoneMatch = aws.String("*")
	} else {
		input.IfMatch = aws.String(etag)
	}
	response, err := s.client.PutObject(ctx, input)
	if err != nil {
		code := s3ErrorCode(err)
		if code == "PreconditionFailed" || code == "ConditionalRequestConflict" {
			return syncRemoteObject{}, errSyncConflict
		}
		return syncRemoteObject{}, fmt.Errorf("S3 upload: %w", err)
	}
	return syncRemoteObject{Content: content, ETag: aws.ToString(response.ETag)}, nil
}

func s3ErrorCode(err error) string {
	var apiError smithy.APIError
	if errors.As(err, &apiError) {
		return apiError.ErrorCode()
	}
	return ""
}
