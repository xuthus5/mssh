import type {
  AIProviderProfileInput,
  ModelsDevCatalog,
  ModelsDevModel,
  ModelsDevProvider,
} from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

export function applyProviderPreset(
  draft: AIProviderProfileInput,
  provider: ModelsDevProvider,
): AIProviderProfileInput {
  return {
    ...draft,
    name: provider.name,
    provider: provider.provider,
    base_url: provider.base_url,
    default_model: '',
    context_window_size: 0,
    max_tokens: 0,
    temperature: null,
  }
}

export function applyModelPreset(
  draft: AIProviderProfileInput,
  model: ModelsDevModel,
): AIProviderProfileInput {
  return {
    ...draft,
    default_model: model.id,
    context_window_size: model.context_window_size,
    max_tokens: model.max_tokens,
    temperature: model.temperature_supported === false ? null : draft.temperature,
  }
}

export function selectedCatalogProvider(
  catalog: ModelsDevCatalog | null,
  draft: AIProviderProfileInput,
): ModelsDevProvider | undefined {
  return catalog?.providers.find((provider) => (
    provider.provider === draft.provider && provider.base_url === draft.base_url
  ))
}

export function selectedCatalogModel(
  catalog: ModelsDevCatalog | null,
  draft: AIProviderProfileInput,
): ModelsDevModel | undefined {
  return selectedCatalogProvider(catalog, draft)?.models.find((model) => model.id === draft.default_model)
}
