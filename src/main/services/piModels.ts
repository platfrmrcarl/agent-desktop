import { loadPISdk } from './piSdk'

export interface PIModelOption {
  value: string
  label: string
}

type PIModel = {
  provider: string
  id: string
  name?: string
}

type PIContext = {
  authStorage: unknown
  modelRegistry: {
    getAvailable(): Promise<PIModel[]>
    find(provider: string, id: string): PIModel | undefined
  }
}

export async function createPIModelContext(): Promise<PIContext> {
  const pi = await loadPISdk()
  const authStorage = pi.AuthStorage.create()
  const modelRegistry = new pi.ModelRegistry(authStorage)
  return { authStorage, modelRegistry }
}

function toModelValue(model: PIModel): string {
  return `${model.provider}/${model.id}`
}

export async function discoverPIModels(): Promise<PIModelOption[]> {
  const { modelRegistry } = await createPIModelContext()
  const available = await modelRegistry.getAvailable()
  return available.map((model) => ({
    value: toModelValue(model),
    label: toModelValue(model),
  }))
}

export async function resolvePIModel(modelId: string): Promise<PIModel> {
  const { modelRegistry } = await createPIModelContext()

  if (modelId.includes('/')) {
    const [provider, ...rest] = modelId.split('/')
    const resolvedId = rest.join('/')
    const model = modelRegistry.find(provider, resolvedId)
    if (!model) throw new Error(`PI model not available: ${modelId}`)
    return model
  }

  const available = await modelRegistry.getAvailable()
  const matches = available.filter((model) => model.id === modelId)
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) throw new Error(`PI model is ambiguous: ${modelId}`)
  throw new Error(`PI model not available: ${modelId}`)
}
