package service

import (
	"fmt"
	"runtime"
	"strings"
)

func testUpdateAssetName(tag string) string {
	name := fmt.Sprintf("mssh-%s-%s-%s", strings.TrimPrefix(tag, "v"), runtime.GOOS, runtime.GOARCH)
	switch runtime.GOOS {
	case "windows":
		name += ".exe"
	case "darwin":
		name += ".app.zip"
	}
	return name
}

func testUpdateAssetJSON(tag string) string {
	name := testUpdateAssetName(tag)
	url := fmt.Sprintf("https://github.com/xuthus5/mssh/releases/download/%s/%s", tag, name)
	return fmt.Sprintf(`{"name":%q,"browser_download_url":%q,"content_type":"application/octet-stream","size":128}`, name, url)
}

func testUpdateReleaseBody(tag string) string {
	return fmt.Sprintf(`{"tag_name":%q,"html_url":"https://github.com/xuthus5/mssh/releases/tag/%s","assets":[%s]}`,
		tag, tag, testUpdateAssetJSON(tag))
}
