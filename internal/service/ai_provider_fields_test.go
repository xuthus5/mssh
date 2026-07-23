package service

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestValidateAIProviderFields(t *testing.T) {
	base := model.AIProviderProfileInput{
		Name: "p", Provider: model.AIProviderOpenAICompatible, BaseURL: "https://api.openai.com/v1", DefaultModel: "gpt",
	}
	require.NoError(t, validateAIProviderFields(base))

	badName := base
	badName.Name = strings.Repeat("n", maxAIProviderNameRunes+1)
	require.Error(t, validateAIProviderFields(badName))

	badModel := base
	badModel.DefaultModel = strings.Repeat("m", maxAIProviderModelRunes+1)
	require.Error(t, validateAIProviderFields(badModel))

	badURL := base
	badURL.BaseURL = strings.Repeat("u", maxAIProviderURLBytes+1)
	require.Error(t, validateAIProviderFields(badURL))

	badKey := base
	badKey.APIKey = strings.Repeat("k", maxAIProviderAPIKeyBytes+1)
	require.Error(t, validateAIProviderFields(badKey))

	badProvider := base
	badProvider.Provider = "nope"
	require.Error(t, validateAIProviderFields(badProvider))

	nulName := base
	nulName.Name = string([]byte{'a', 0})
	require.Error(t, validateAIProviderFields(nulName))
}
