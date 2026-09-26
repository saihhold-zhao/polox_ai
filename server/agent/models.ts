import type { AgentSession } from './session'
import type { AgentEvent, AgentImage } from './types'
import { AGENT_MODELS, findAgentModelTool, readModelMentions, validateAgentModelInput } from '~~/shared/utils/agentModels'
import { IMAGE_TEXT_EDITOR_MODEL, textEditPrompt } from '~~/shared/utils/imageTextEditor'
import { adaptImageKResolution, constrainImageKResolution, imageKResolutionFamily, modelIsImageToImage, modelSupportsImageKResolution, pickNearestImageResolution } from '~~/shared/utils/imageResolution'
import { SKETCH_TO_IMAGE_MODEL, SKETCH_TO_IMAGE_TOOL } from '~~/shared/utils/sketchToImage'
import { wavespeedEndpoint } from '../../shared/utils/wavespeedSchema'
import { GenerationJob } from '../models/generationJob'
import { falEndpoint } from '../utils/falInput'
import { sanitizeGenerateInput } from '../utils/generateInput'
import { refreshGenerationJob } from '../utils/generationPipeline'
import { toPublicJob } from '../utils/generationResults'
import { confirmedAnnotationEdit } from './imageAnnotations'
import { confirmedObjectRemovalEdit } from './imageObjectRemoval'
import { probeImageDimensions } from './imageDimensions'
import { confirmedTextEdit } from './imageTextEditor'
import { confirmedLayerSelections, isLayerSplitterModelId, isLayerSplitterRequest, layerSplitBlocksGeneration, layerSplitNeedsConfirm, layerSplitNeedsPlan } from './layerSplitBrief'
import { persistNow, upsertImage } from './session'
import { sketchBrief } from './sketchBrief'
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
    const ids = readModelMentions(text, true)
    return ids
  }
  return []
}
export async function prepareModelGeneration(tool: string, json: string, session: AgentSession): Promise<ModelGeneration> {
  const model = findAgentModelTool(tool)
  if (!model)
    throw new Error('Unknown model')
  const sketch = sketchBrief(session.messages)
  if (sketch && (!sketch.understandingDone || sketch.cancelled))
    throw new Error('Follow the sketch-to-image skill: finish sketch_references and confirm sketch_understanding before generation.')
  if (sketch && ![SKETCH_TO_IMAGE_TOOL, SKETCH_TO_IMAGE_MODEL].includes(model.id))
    throw new Error('Use model_sketch_to_image for this sketch workflow.')
  if (model.id === SKETCH_TO_IMAGE_TOOL) {
    if (!sketch?.understandingDone)
      throw new Error('Save a sketch and complete the sketch-to-image skill before generating.')
    const raw = JSON.parse(json)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Model parameters must be an object')
    return prepareModelGeneration(`model_${SKETCH_TO_IMAGE_MODEL.replaceAll('-', '_')}`, JSON.stringify({ ...raw, images: sketch.inputUrls }), session)
  }
  if (isLayerSplitterModelId(model.id) && isLayerSplitterRequest(session.messages) && (layerSplitNeedsPlan(session.messages) || layerSplitNeedsConfirm(session.messages) || layerSplitBlocksGeneration(session.messages)))
    throw new Error('Layer targets are not confirmed yet. Do not invent regions or show a generation confirmation. Call ask_user with layer_selection_method (Draw boxes / Describe the layers / Other) when needed. After boxes or a description, inspect the image and call ask_user with layer_split_confirm (confirm / adjust / Other). Only generate after Confirm. A model mention followed by an upload is not a confirmed splitting plan.')
  if (model.id === 'image-text-editor') {
    const requestedImage = String(JSON.parse(json).image_url || '')
    const sourceUrl = session.images.find(image => image.id === requestedImage)?.url || requestedImage
    const edit = confirmedTextEdit(session, sourceUrl)
    if (!edit || !session.images.some(image => image.url === edit.imageUrl && image.status === 'success'))
      throw new Error('Open the text editor and wait for the user to confirm edits first.')
    const modelId = IMAGE_TEXT_EDITOR_MODEL
    const prompt = textEditPrompt(edit.lines)
    let resolution = '1k'
    try {
      const dims = await probeImageDimensions(edit.imageUrl)
      resolution = adaptImageKResolution(
        constrainImageKResolution(pickNearestImageResolution(dims.width, dims.height), 'auto', imageKResolutionFamily(modelId)),
        ['1k', '2k', '4k'],
      )
    }
    catch { /* Keep 1k if probing fails. */ }
    const input = sanitizeGenerateInput(modelId, { prompt, quality: 'high', resolution, images: [edit.imageUrl] })
    return { modelId, name: 'Image text edit', input, requestModel: wavespeedEndpoint(modelId)!, uncertainFields: [], inputUrls: [edit.imageUrl] }
  }
  const selected = selectedModelIds(session).map(id => id === SKETCH_TO_IMAGE_TOOL ? SKETCH_TO_IMAGE_MODEL : id)
  const categorySelections = selected.filter(id => AGENT_MODELS.find(item => item.id === id)?.category === model.category)
  if (categorySelections.length && !categorySelections.includes(model.id))
    throw new Error(`The user selected ${categorySelections.join(', ')}. Use that exact model tool, or ask before changing models.`)
  const raw = JSON.parse(json)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Model parameters must be an object')
  if (sketch && model.id === SKETCH_TO_IMAGE_MODEL)
    raw.images = sketch.inputUrls
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
        ? session.images.find(image => image.status === 'success' && image.url && (
            key.includes('audio')
              ? image.kind === 'audio'
              : key.includes('video')
                ? image.kind === 'video'
                : image.kind !== 'video' && image.kind !== 'audio'
          ))
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
  const annotation = confirmedAnnotationEdit(session)
  if (annotation && model.task === 'Image to Image') {
    const imageField = ['images', 'input_urls', 'image_urls', 'image_input'].find(key => key in model.schema.components.schemas.Input.properties)
    if (!imageField)
      throw new Error('This model cannot accept the original image and annotation guide.')
    const urls = Array.isArray(raw[imageField]) ? raw[imageField] : []
    raw[imageField] = [...new Set([annotation.imageUrl, annotation.annotatedImageUrl, ...annotation.points.flatMap(point => (point.references || []).map(reference => reference.url)), ...urls])]
  }
  const objectRemoval = confirmedObjectRemovalEdit(session)
  if (objectRemoval && model.task === 'Image to Image') {
    const imageField = ['images', 'input_urls', 'image_urls', 'image_input'].find(key => key in model.schema.components.schemas.Input.properties)
    if (!imageField)
      throw new Error('This model cannot accept the original image and removal overlay.')
    const urls = Array.isArray(raw[imageField]) ? raw[imageField] : []
    raw[imageField] = [...new Set([objectRemoval.imageUrl, objectRemoval.annotatedImageUrl, ...urls])]
  }

  const validated = validateAgentModelInput(model, raw)
  const input = sanitizeGenerateInput(model.id, validated)
  if (modelSupportsImageKResolution(model) && modelIsImageToImage(model)) {
    const imageField = ['images', 'input_urls', 'image_urls', 'image_input', 'image_url', 'image'].find(key => key in input)
    const first = imageField
      ? (Array.isArray(input[imageField]) ? input[imageField][0] : input[imageField])
      : undefined
    if (typeof first === 'string' && /^https?:\/\//i.test(first)) {
      try {
        const dims = await probeImageDimensions(first)
        const aspect = String(input.aspect_ratio || 'auto')
        const picked = constrainImageKResolution(
          pickNearestImageResolution(dims.width, dims.height),
          aspect,
          imageKResolutionFamily(model.id),
        )
        const enumValues = model.schema.components.schemas.Input.properties.resolution?.enum
        input.resolution = adaptImageKResolution(picked, enumValues)
      }
      catch { /* Keep sanitized resolution if probing fails. */ }
    }
  }
  const name = String(raw._name || model.name).slice(0, 100)
  return {
    modelId: model.id,
    name,
    input,
    requestModel: wavespeedEndpoint(model.id) || falEndpoint(model.id, input),

    uncertainFields: Array.isArray(raw._uncertain_fields) ? raw._uncertain_fields.filter((key: unknown) => typeof key === 'string' && key in model.schema.components.schemas.Input.properties) : [],
    inputUrls: Object.entries(input).filter(([key]) => key === 'image' || key.includes('url') || model.schema.components.schemas.Input.properties[key]?.['x-ui-component'] === 'uploaders').flatMap(([, value]) => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === 'string' && /^https?:\/\//i.test(value)),
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
    .filter(([key]) => (key === 'image' || key.includes('url') || model.schema.components.schemas.Input.properties[key]?.['x-ui-component'] === 'uploaders') && (kind === 'image' ? !key.includes('video') && !key.includes('audio') : key.includes(kind)))
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
        const urls = [...job.resultUrls]
        for (const [i, url] of urls.entries()) {
          const next = {
            ...image,
            name: layers?.[i]?.name || image.name,
            id: i ? `${callId}_${i}` : callId,
            status: 'success' as const,
            url,
            kind: image.kind,
          }
          upsertImage(session, next)
          emit({ type: 'image', image: next })
        }
        return JSON.stringify({ ok: true, model: model.id, urls })
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
