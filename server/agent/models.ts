import type { AgentSession } from './session'
import type { AgentEvent, AgentImage } from './types'
import { AGENT_MODELS, findAgentModelTool, readModelMentions, validateAgentModelInput } from '~~/shared/utils/agentModels'
import { textEditPrompt } from '~~/shared/utils/imageTextEditor'
import { GenerationJob } from '../models/generationJob'
import { falEndpoint } from '../utils/falInput'
import { sanitizeGenerateInput } from '../utils/generateInput'
import { refreshGenerationJob } from '../utils/generationPipeline'
import { toPublicJob } from '../utils/generationResults'
import { confirmedTextEdit } from './imageTextEditor'
import { confirmedLayerSelections, layerSplitNeedsPlan } from './layerSplitBrief'
import { persistNow, upsertImage } from './session'
import { acquireGenerationSlot } from './slots'

export interface ModelGeneration {
  modelId: string
  name: string
  input: Record<string, unknown>
  requestModel: string

  uncertainFields: string[]
  inputUrls: string[]
}
export function selectedModelIds(session: Pick<AgentSession, 'messages'>) {
  for (const message of [...session.messages].reverse()) {
    if (message.role !== 'user' || message.internal)
      continue
    const text = typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.filter(part => part.type === 'text').map(part => part.text).join('\n') : ''
    const ids = readModelMentions(text)
    return ids
  }
  return []
}
export async function prepareModelGeneration(tool: string, json: string, session: AgentSession): Promise<ModelGeneration> {
  const model = findAgentModelTool(tool)
  if (!model)
    throw new Error('Unknown model')
  if (model.id === 'image-layer-splitter' && layerSplitNeedsPlan(session.messages))
    throw new Error('Layer targets are missing. Do not invent regions or show a generation confirmation. Call ask_user with layer_selection_method (Draw boxes / Describe the layers / Other) and wait. If Describe the layers was already selected, call ask_user with layer_split_plan containing image-specific extraction proposals and Other, then wait. If Draw boxes was selected, request actual regions. A model mention followed by an upload is not a confirmed splitting plan.')
  if (model.id === 'image-text-editor') {
    const requestedImage = String(JSON.parse(json).image_url || '')
    const sourceUrl = session.images.find(image => image.id === requestedImage)?.url || requestedImage
    const edit = confirmedTextEdit(session, sourceUrl)
    if (!edit || !session.images.some(image => image.url === edit.imageUrl && image.status === 'success'))
      throw new Error('Open the text editor and wait for the user to confirm edits first.')
    const modelId = 'gpt-image-2-image-to-image'
    const prompt = textEditPrompt(edit.lines)
    const input = sanitizeGenerateInput(modelId, { prompt, image_size: 'auto', quality: 'high', image_urls: [edit.imageUrl] })
    return { modelId, name: 'Image text edit', input, requestModel: falEndpoint(modelId, input), uncertainFields: [], inputUrls: [edit.imageUrl] }
  }
  const selected = selectedModelIds(session)
  const categorySelections = selected.filter(id => AGENT_MODELS.find(item => item.id === id)?.category === model.category)
  if (categorySelections.length && !categorySelections.includes(model.id))
    throw new Error(`The user selected ${categorySelections.join(', ')}. Use that exact model tool, or ask before changing models.`)
  const raw = JSON.parse(json)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Model parameters must be an object')
    // Session IDs and latest are resolved only for actual media fields.
  for (const [key, property] of Object.entries(model.schema.components.schemas.Input.properties)) {
    if (!key.includes('url') && property['x-ui-component'] !== 'uploaders')
      continue
    const resolve = (value: unknown) => {
      if (typeof value !== 'string')
        return value
      if (/^https?:\/\//i.test(value))
        return value
      const media = value === 'latest'
        ? session.images.find(image => image.status === 'success' && image.url && (key.includes('video') ? image.kind === 'video' : image.kind !== 'video'))
        : session.images.find(image => image.id === value && image.status === 'success' && image.url)
      if (!media)
        throw new Error(`Missing media for ${key}. Ask the user to upload it; never invent a URL.`)
      return media.url
    }
    if (raw[key] !== undefined)
      raw[key] = Array.isArray(raw[key]) ? raw[key].map(resolve) : resolve(raw[key])
  }
  if (model.id === 'image-layer-splitter') {
    const selections = confirmedLayerSelections(session.messages)
    const selection = raw.image_url === undefined && selections.length === 1
      ? selections[0]
      : selections.find(item => item.imageUrl === raw.image_url)
    if (selections.length && !selection)
      throw new Error('Specify the source image with confirmed boxes for this split. For multiple images, call the splitter once per image using its own image_url and regions; never reuse another image’s boxes.')
    if (selection) {
      raw.image_url = selection.imageUrl
      raw.regions = selection.regions
    }
  }
  const validated = validateAgentModelInput(model, raw)
  const input = sanitizeGenerateInput(model.id, validated)
  return {
    modelId: model.id,
    name: String(raw._name || model.name).slice(0, 100),
    input,
    requestModel: falEndpoint(model.id, input),

    uncertainFields: Array.isArray(raw._uncertain_fields) ? raw._uncertain_fields.filter((key: unknown) => typeof key === 'string' && key in model.schema.components.schemas.Input.properties) : [],
    inputUrls: Object.entries(input).filter(([key]) => key.includes('url') || model.schema.components.schemas.Input.properties[key]?.['x-ui-component'] === 'uploaders').flatMap(([, value]) => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === 'string' && /^https?:\/\//i.test(value)),
  }
}
export function modelConfirmation(args: ModelGeneration) {
  const model = AGENT_MODELS.find(model => model.id === args.modelId)!
  return {
    name: args.name,
    modelName: model.name,
    task: model.task,
    inputUrls: args.inputUrls,
    params: {
      prompt: String(args.input.prompt || ''),
      aspectRatio: String(args.input.aspect_ratio || ''),
      resolution: String(args.input.resolution || ''),
      duration: Number(args.input.duration) || undefined,
      modelId: args.modelId,
      modelInput: args.input,
    },
  }
}
export async function runModelGeneration(session: AgentSession, callId: string, args: ModelGeneration, emit: (event: AgentEvent) => void) {
  const model = AGENT_MODELS.find(model => model.id === args.modelId)!
  const mediaUrls = (kind: 'image' | 'video' | 'audio') => Object.entries(args.input)
    .filter(([key]) => (key.includes('url') || model.schema.components.schemas.Input.properties[key]?.['x-ui-component'] === 'uploaders') && (kind === 'image' ? !key.includes('video') && !key.includes('audio') : key.includes(kind)))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === 'string' && /^https?:\/\//i.test(value))
  const image: AgentImage = {
    id: callId,
    name: args.name,
    modelId: model.id,
    modelInput: args.input,
    kind: model.category === 'Video' ? 'video' : model.task === 'Remove Background' ? 'cutout' : 'still',
    status: 'generating',
    prompt: String(args.input.prompt || ''),
    aspectRatio: String(args.input.aspect_ratio || ''),
    resolution: String(args.input.resolution || ''),
    duration: Number(args.input.duration) || undefined,
    inputUrls: mediaUrls('image'),
    referenceVideoUrls: mediaUrls('video'),
    url: '',
    error: '',
  }
  upsertImage(session, image)
  emit({ type: 'image', image })
  emit({ type: 'tool', name: model.id, status: 'start', callId })
  let savedJob = false
  let terminalFailure = false
  try {
    const slot = await acquireGenerationSlot({ sessionId: session.id, callId, projectId: session.projectId, meta: {
      kind: image.kind,
      prompt: image.prompt,
      inputUrls: mediaUrls('image'),
      referenceVideoUrls: [...mediaUrls('video'), ...mediaUrls('audio')],
      modelId: model.id,
      modelInput: args.input,
      requestModel: args.requestModel,
    } })
    savedJob = true
    if (slot.queued)
      emit({ type: 'status', status: 'queued' })
    const deadline = Date.now() + 40 * 60 * 1000
    while (Date.now() < deadline) {
      const stored = await GenerationJob.findOne({ taskId: `agent_${callId}` })
      if (!stored)
        throw new Error('Generation job was not saved')
      const job = await refreshGenerationJob(stored)
      if (!job)
        throw new Error('Generation job was not found')
      if (job.providerTaskId && image.providerTaskId !== job.providerTaskId) {
        image.providerTaskId = job.providerTaskId
        upsertImage(session, image)
        persistNow(session)
      }
      if (job.state === 'fail') {
        terminalFailure = true
        throw new Error(job.failMsg || 'Generation failed')
      }
      if (job.state === 'success') {
        const layers = toPublicJob(job).layers
        for (const [i, url] of job.resultUrls.entries()) {
          const next = { ...image, name: layers?.[i]?.name || image.name, id: i ? `${callId}_${i}` : callId, status: 'success' as const, url }
          upsertImage(session, next)
          emit({ type: 'image', image: next })
        }
        return JSON.stringify({ ok: true, model: model.id, urls: job.resultUrls })
      }
      emit({ type: 'status', status: job.state === 'queued' ? 'queued' : 'generating' })
      await new Promise(resolve => setTimeout(resolve, 2500))
    }
    // Persisted jobs are resumed by the normal generation pipeline.
    return JSON.stringify({ ok: false, pending: true, error: 'Generation continues in the background' })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed'
    if (savedJob && !terminalFailure) {
      persistNow(session)
      return JSON.stringify({ ok: false, pending: true, error: 'Generation continues in the background' })
    }
    const next = { ...image, status: 'fail' as const, error: message }
    upsertImage(session, next)
    emit({ type: 'image', image: next })
    return JSON.stringify({ ok: false, error: message })
  }
  finally {
    emit({ type: 'tool', name: model.id, status: 'end', callId })
  }
}
