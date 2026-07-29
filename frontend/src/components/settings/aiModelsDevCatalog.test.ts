import { describe, expect, it } from 'vitest'
import { emptyProvider } from '@/components/settings/aiProviderPanelRuntime'
import { applyModelPreset, applyProviderPreset } from '@/components/settings/aiModelsDevCatalog'

describe('models.dev provider presets', () => {
  it('applies provider routing and clears model-specific values', () => {
    const draft = { ...emptyProvider(), api_key: 'keep', default_model: 'old', context_window_size: 1, max_tokens: 2, temperature: 0.7 }
    const result = applyProviderPreset(draft, provider())
    expect(result).toEqual(expect.objectContaining({
      name: 'OpenRouter', provider: 'openai_compatible', base_url: 'https://openrouter.ai/api/v1',
      api_key: 'keep', default_model: '', context_window_size: 0, max_tokens: 0, temperature: null,
    }))
  })

  it('applies model limits and clears unsupported temperature', () => {
    const result = applyModelPreset({ ...emptyProvider(), temperature: 0.7 }, model(false))
    expect(result).toEqual(expect.objectContaining({
      default_model: 'vendor/model', context_window_size: 64000, max_tokens: 4096, temperature: null,
    }))
  })

  it('preserves temperature when support is not explicitly disabled', () => {
    const result = applyModelPreset({ ...emptyProvider(), temperature: 0.3 }, model(null))
    expect(result.temperature).toBe(0.3)
  })
})

function provider() {
  return { id: 'openrouter', name: 'OpenRouter', provider: 'openai_compatible', base_url: 'https://openrouter.ai/api/v1', models: [] } as never
}

function model(temperatureSupported: boolean | null) {
  return { id: 'vendor/model', name: 'Vendor Model', description: '', context_window_size: 64000, max_tokens: 4096, reasoning: false, temperature_supported: temperatureSupported, status: '' } as never
}
