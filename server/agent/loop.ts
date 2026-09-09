import type { ModelGeneration } from './models'
import type { AgentSession, PendingToolItem } from './session'
import type { SlotMeta } from './slots'
import type { AgentConfirmPolicy, AgentEvent, AgentImage, AskUserArgs, ChatMessage, ChoiceAnswer, ChoiceBody, ConfirmationPayload, ConfirmBody, GenerateImageArgs, ResolvedGenerateVideo, ResolvedRemoveBackground, ToolCall, UserContentPart } from './types'
import { withCustomChoiceOption } from '~~/shared/utils/agentChoices'
import { validateLayerSelection, validateLayerSelections } from '~~/shared/utils/agentLayerSelection'
import { AGENT_MODELS, findAgentModelTool, readModelMentions, registeredModelTools } from '~~/shared/utils/agentModels'
import { validateTextEditAnswer, validateTextEditAnswers } from '~~/shared/utils/imageTextEditor'
import { concatVideoUrls } from './concat'
import { EXPORT_ZIP_TOOL, exportSessionZip, resolveZipExport } from './exportZip'
import { removeBackground } from './fal'
import { confirmedTextEdit, detectImageText, textEditNeedsSummary } from './imageTextEditor'
import { generateGptImage2, generateSeedance2, generateSeedance25, generateWan30 } from './modelGeneration'
import { hasLayerSourceImage, layerSplitNeedsPlan, layerSplitNeedsSummary, needsLayerDescriptionCard } from './layerSplitBrief'
import { assembleToolCalls, streamChat } from './llm'
import { modelPreferenceFromChoice } from './modelPreference'
import { modelConfirmation, prepareModelGeneration, runModelGeneration, selectedModelIds } from './models'
import { MAX_STEPS } from './policy'
import { applyImageQuality, applyVideoQuality, clampVideoToFamily, parseAgentConfirmPolicy, parseAgentQuality, parseVideoFamily } from './quality'
import { restoreSessionContext } from './restore'
import { scheduleSessionResume } from './resume'
import { choiceAlreadyAnswered, confirmationAlreadyStarted, persistNow, refreshSessionPrompt, requireLoadedSession, requireSession, resolveChatSession, touch, upsertImage } from './session'
import { acquireGenerationSlot, bindGenerationSlot, completeGenerationSlot, waitForGenerationSlot } from './slots'
import { summarizeSessionTitle } from './title'
import { ASK_USER_TOOL, CONCAT_VIDEO_TOOL, GENERATE_IMAGE_TOOL, GENERATE_VIDEO_TOOL, openAiTools, parseAskUserArgs, parseConcatVideoArgs, parseGenerateImageArgs, parseGenerateVideoArgs, parseRemoveBackgroundArgs, REMOVE_BACKGROUND_TOOL, resolveConcatVideoUrls, resolveGenerateImageArgs, resolveGenerateVideoArgs, resolveRemoveBackgroundSource } from './tools'
import { uploadAgentImage } from './upload'

type Emit = (event: AgentEvent) => void
const autoConfirmInFlight = new Set<string>()
const STOP_NOTE = 'Stopped. In-progress generations will keep running.'
function sessionWantsStop(session: AgentSession) {
  return Boolean(session.stopRequested)
}
function isLoopAbort(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError'
    || error.message === 'Aborted'
    || error.message === 'This operation was aborted')
}
function lastAssistantIsStopNote(session: AgentSession) {
  const last = session.messages[session.messages.length - 1]
  return last?.role === 'assistant'
    && typeof last.content === 'string'
    && last.content.includes('Stopped.')
}
function noteAgentStopped(session: AgentSession, emit?: Emit) {
  if (!lastAssistantIsStopNote(session)) {
    session.messages.push({ role: 'assistant', content: STOP_NOTE })
    emit?.({ type: 'text', delta: STOP_NOTE })
  }
  touch(session)
}
export function shouldServerAutoConfirm(policy: AgentConfirmPolicy, payload: ConfirmationPayload | null | undefined) {
  if (!payload)
    return false
  if (policy === 'auto')
    return true
  if (policy === 'always')
    return false
  return !(payload.uncertainFields?.length)
}
/**
 * Automatic / when_needed confirmation without the browser.
 * Returns true when generation ran and the agent loop should continue.
 */
async function tryServerAutoConfirm(sessionId: string, emit: Emit, signal?: AbortSignal) {
  const session = requireSession(sessionId)
  if (sessionWantsStop(session))
    return false
  const pending = session.pendingConfirmation
  if (!pending || !shouldServerAutoConfirm(session.confirmPolicy, pending.payload))
    return false
  const items = pending.items
  const params = pending.payload.params
  const confirmationId = pending.payload.id
  session.pendingConfirmation = null
  emit({
    type: 'confirmation',
    confirmation: {
      ...pending.payload,
      approvedBy: 'agent',
    },
  })
  touch(session)
  await runConfirmedItems(sessionId, items, {
    confirmationId,
    action: 'confirm',
    params,
  }, emit, signal)
  return true
}
/** Resume a parked auto confirmation after the browser left or the process restarted. */
export async function continueServerAutoConfirm(sessionId: string) {
  const session = requireSession(sessionId)
  if (session.busy || sessionWantsStop(session) || autoConfirmInFlight.has(sessionId))
    return false
  if (!session.pendingConfirmation || !shouldServerAutoConfirm(session.confirmPolicy, session.pendingConfirmation.payload))
    return false
  autoConfirmInFlight.add(sessionId)
  session.busy = true
  touch(session)
  const emit: Emit = () => { }
  try {
    const ran = await tryServerAutoConfirm(sessionId, emit)
    if (!ran)
      return false
    await runAgentLoop(sessionId, emit)
    return true
  }
  finally {
    session.busy = false
    autoConfirmInFlight.delete(sessionId)
    touch(session)
  }
}
function answeredToolCallIds(session: AgentSession) {
  const answered = new Set<string>()
  for (const message of session.messages) {
    if (message.role === 'tool' && message.tool_call_id)
      answered.add(message.tool_call_id)
  }
  return answered
}
function toolResultFromImage(image: AgentImage) {
  if (image.status === 'success' && image.url) {
    return JSON.stringify({
      ok: true,
      name: image.name,
      urls: [image.url],
      prompt: image.prompt,
      aspect_ratio: image.aspectRatio,
      resolution: image.resolution,
      duration: image.duration,
      family: image.videoFamily,
    })
  }
  if (image.status === 'fail') {
    return JSON.stringify({
      ok: false,
      error: image.error || 'Generation failed',
    })
  }
  return ''
}
/** After a process restart, fill missing tool messages from completed images (image id === tool call id). */
export function sealOpenToolResultsFromImages(sessionId: string) {
  const session = requireSession(sessionId)
  const answered = answeredToolCallIds(session)
  let changed = false
  for (const image of session.images) {
    if (image.status === 'generating')
      continue
    if (answered.has(image.id))
      continue
    const content = toolResultFromImage(image)
    if (!content)
      continue
    appendToolResult(sessionId, image.id, content)
    answered.add(image.id)
    changed = true
  }
  if (changed)
    touch(session)
  return changed
}
function needsLoopContinuation(session: AgentSession) {
  const messages = session.messages
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === 'assistant' && message.tool_calls?.length) {
      const ids = message.tool_calls.map(item => item.id)
      const answered = answeredToolCallIds(session)
      if (!ids.every(id => answered.has(id)))
        return false
      for (let after = index + 1; after < messages.length; after++) {
        if (messages[after]?.role === 'assistant')
          return false
      }
      return true
    }
    if (message?.role === 'assistant')
      return false
  }
  return false
}
/**
 * Continue an Automatic session after deploy/restart once media has settled:
 * seal tool results, auto-confirm if needed, then run the agent loop again.
 */
export async function continueAgentSession(sessionId: string) {
  const session = requireSession(sessionId)
  if (session.busy || sessionWantsStop(session) || autoConfirmInFlight.has(sessionId))
    return false
  if (session.images.some(item => item.status === 'generating'))
    return false
  sealOpenToolResultsFromImages(sessionId)
  if (session.pendingConfirmation && shouldServerAutoConfirm(session.confirmPolicy, session.pendingConfirmation.payload))
    return continueServerAutoConfirm(sessionId)
  if (session.pendingChoice)
    return false
  if (!needsLoopContinuation(session))
    return false
  autoConfirmInFlight.add(sessionId)
  session.busy = true
  touch(session)
  try {
    await runAgentLoop(sessionId, () => { })
    return true
  }
  finally {
    session.busy = false
    autoConfirmInFlight.delete(sessionId)
    touch(session)
  }
}
function rememberProviderTask(sessionId: string, image: AgentImage, bindProvider: (providerTaskId: string) => Promise<void>) {
  return async (providerTaskId: string) => {
    image.providerTaskId = providerTaskId
    const session = requireSession(sessionId)
    upsertImage(session, image)
    persistNow(session)
    await bindProvider(providerTaskId)
  }
}
function isAbortMessage(message: string) {
  return /aborted/i.test(message)
}
function keepGeneratingOnDisconnect(sessionId: string, image: AgentImage, message: string, emit: Emit) {
  if (!isAbortMessage(message) || !String(image.providerTaskId || '').trim())
    return false
  const session = requireSession(sessionId)
  const next = {
    ...image,
    status: 'generating' as const,
    error: '',
  }
  upsertImage(session, next)
  persistNow(session)
  scheduleSessionResume(session)
  emit({ type: 'image', image: next })
  return true
}
interface LoopRequestOptions {
  projectId?: string
  bffUrl?: string
  history?: unknown
  images?: unknown
}
async function withGenerationSlot(sessionId: string, callId: string, emit: Emit, signal: AbortSignal | undefined, meta: SlotMeta, work: (bindProvider: (providerTaskId: string) => Promise<void>) => Promise<{
  url?: string
  result: string
}>) {
  const session = requireSession(sessionId)
  let url = ''
  let error = ''
  let result = ''
  const bindProvider = async (providerTaskId: string) => {
    await bindGenerationSlot({
      callId,
      providerTaskId,
      bffUrl: session.bffUrl,
    })
  }
  try {
    const acquired = await acquireGenerationSlot({
      sessionId,
      callId,
      projectId: session.projectId,
      bffUrl: session.bffUrl,
      meta,
      signal,
    })
    if (acquired.queued) {
      emit({ type: 'status', status: 'queued' })
      emit({
        type: 'queue',
        limit: acquired.limit,
        active: acquired.active,
        message: acquired.message,
      })
      await waitForGenerationSlot({
        callId,
        bffUrl: session.bffUrl,
        signal,
        onUpdate: (slot) => {
          if (slot.queued) {
            emit({
              type: 'queue',
              limit: slot.limit,
              active: slot.active,
              message: slot.message,
            })
          }
        },
      })
    }
    emit({ type: 'status', status: 'generating' })
    const done = await work(bindProvider)
    url = done.url || ''
    result = done.result
  }
  catch (err) {
    error = err instanceof Error ? err.message : 'Generation failed'
  }
  const completed = await completeGenerationSlot({
    callId,
    bffUrl: session.bffUrl,
    url: error ? '' : url,
    error,
  })

  if (!error && completed.state === 'fail' && completed.message)
    error = completed.message
  if (error)
    throw new Error(error)
  return result
}
async function maybeEmitTitle(sessionId: string, emit: Emit) {
  const session = requireSession(sessionId)
  if (session.title)
    return
  try {
    const title = await summarizeSessionTitle(session.messages)
    const current = requireSession(sessionId)
    if (!title || current.title)
      return
    current.title = title
    touch(current)
    emit({ type: 'title', title })
  }
  catch {
    // Keep the untitled session if summarization fails.
  }
}
async function runGeneration(sessionId: string, callId: string, args: GenerateImageArgs, emit: Emit, signal?: AbortSignal) {
  const session = requireSession(sessionId)
  const image = {
    id: callId,
    kind: 'still' as const,
    status: 'generating' as const,
    name: args.name,
    prompt: args.prompt,
    aspectRatio: args.aspect_ratio,
    resolution: args.resolution,
    url: '',
    error: '',
    sourceUrl: args.input_urls[0] || '',
    inputUrls: uniqueHttpUrls(args.input_urls),
  }
  upsertImage(session, image)
  emit({ type: 'status', status: 'generating' })
  emit({ type: 'image', image })
  emit({ type: 'tool', name: GENERATE_IMAGE_TOOL, status: 'start', callId })
  try {
    return await withGenerationSlot(sessionId, callId, emit, signal, {
      kind: 'still',
      prompt: args.prompt,
      aspectRatio: args.aspect_ratio,
      resolution: args.resolution,
      sourceUrl: args.input_urls[0] || '',
      inputUrls: image.inputUrls,
    }, async (bindProvider) => {
      const result = await generateGptImage2({
        prompt: args.prompt,
        aspect_ratio: args.aspect_ratio,
        resolution: args.resolution,
        input_urls: args.input_urls,
      }, undefined, rememberProviderTask(sessionId, image, bindProvider))
      const next = {
        ...image,
        status: 'success' as const,
        url: result.urls[0] || '',
      }
      upsertImage(session, next)
      emit({ type: 'image', image: next })
      return {
        url: next.url,
        result: JSON.stringify({
          ok: true,
          taskId: result.taskId,
          name: image.name,
          urls: result.urls,
          prompt: args.prompt,
          aspect_ratio: args.aspect_ratio,
          resolution: args.resolution,
          input_urls: args.input_urls,
        }),
      }
    })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed'
    if (keepGeneratingOnDisconnect(sessionId, image, message, emit)) {
      return JSON.stringify({
        ok: false,
        pending: true,
        error: 'Generation continues in the background',
      })
    }
    const next = {
      ...image,
      status: 'fail' as const,
      error: message,
    }
    upsertImage(session, next)
    emit({ type: 'image', image: next })
    return JSON.stringify({
      ok: false,
      error: message,
    })
  }
  finally {
    emit({ type: 'tool', name: GENERATE_IMAGE_TOOL, status: 'end', callId })
  }
}
function appendToolResult(sessionId: string, toolCallId: string, content: string) {
  const session = requireSession(sessionId)
  session.messages.push({
    role: 'tool',
    tool_call_id: toolCallId,
    content,
  })
  touch(session)
}
async function runGenerations(sessionId: string, jobs: Array<{
  toolCallId: string
  args: GenerateImageArgs
}>, emit: Emit, signal?: AbortSignal) {
  if (!jobs.length)
    return
  emit({ type: 'status', status: 'generating' })
  const results = await Promise.all(jobs.map(job => runGeneration(sessionId, job.toolCallId, job.args, emit, signal)))
  jobs.forEach((job, index) => {
    appendToolResult(sessionId, job.toolCallId, results[index] || JSON.stringify({ ok: false, error: 'Empty tool result' }))
  })
  inspectGeneratedStills(sessionId, successfulUrls(results))
}
function successfulUrls(results: string[]) {
  const urls: string[] = []
  for (const result of results) {
    try {
      const parsed = JSON.parse(result) as {
        ok?: boolean
        urls?: unknown
      }
      if (!parsed.ok || !Array.isArray(parsed.urls))
        continue
      for (const item of parsed.urls) {
        if (typeof item === 'string' && /^https?:\/\//i.test(item))
          urls.push(item)
      }
    }
    catch {
      // Ignore malformed tool JSON.
    }
  }
  return urls
}
function inspectGeneratedStills(sessionId: string, urls: string[]) {
  if (!urls.length)
    return
  const session = requireSession(sessionId)
  session.messages.push({
    role: 'user',
    internal: true,
    content: [
      {
        type: 'text',
        text: 'Inspect these generated stills from the last tool results. Score them against the brief and hard constraints. Retry only if they miss the request.',
      },
      ...urls.slice(0, 4).map(url => ({ type: 'image_url' as const, image_url: { url } })),
    ],
  })
  touch(session)
}
async function runRemoval(sessionId: string, callId: string, source: ResolvedRemoveBackground, emit: Emit, signal?: AbortSignal) {
  const session = requireSession(sessionId)
  const image = {
    id: callId,
    kind: 'cutout' as const,
    name: '',
    status: 'generating' as const,
    prompt: source.prompt,
    aspectRatio: source.aspectRatio,
    resolution: source.resolution,
    url: '',
    error: '',
    sourceUrl: source.image_url,
    inputUrls: uniqueHttpUrls([source.image_url]),
  }
  upsertImage(session, image)
  emit({ type: 'status', status: 'generating' })
  emit({ type: 'image', image })
  emit({ type: 'tool', name: REMOVE_BACKGROUND_TOOL, status: 'start', callId })
  try {
    return await withGenerationSlot(sessionId, callId, emit, signal, {
      kind: 'cutout',
      prompt: source.prompt,
      aspectRatio: source.aspectRatio,
      resolution: source.resolution,
      sourceUrl: source.image_url,
      inputUrls: image.inputUrls,
    }, async (bindProvider) => {
      const result = await removeBackground(source.image_url, undefined, rememberProviderTask(sessionId, image, bindProvider))
      const next = {
        ...image,
        status: 'success' as const,
        url: result.urls[0] || '',
      }
      upsertImage(session, next)
      emit({ type: 'image', image: next })
      return {
        url: next.url,
        result: JSON.stringify({
          ok: true,
          requestId: result.requestId,
          name: image.name,
          urls: result.urls,
          source_url: source.image_url,
        }),
      }
    })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Background removal failed'
    const next = {
      ...image,
      status: 'fail' as const,
      error: message,
    }
    upsertImage(session, next)
    emit({ type: 'image', image: next })
    return JSON.stringify({
      ok: false,
      error: message,
    })
  }
  finally {
    emit({ type: 'tool', name: REMOVE_BACKGROUND_TOOL, status: 'end', callId })
  }
}
async function runRemovals(sessionId: string, jobs: Array<{
  toolCallId: string
  source: ResolvedRemoveBackground
}>, emit: Emit, signal?: AbortSignal) {
  if (!jobs.length)
    return
  emit({ type: 'status', status: 'generating' })
  const results = await Promise.all(jobs.map(job => runRemoval(sessionId, job.toolCallId, job.source, emit, signal)))
  jobs.forEach((job, index) => {
    appendToolResult(sessionId, job.toolCallId, results[index] || JSON.stringify({ ok: false, error: 'Empty tool result' }))
  })
  inspectGeneratedStills(sessionId, successfulUrls(results))
}
async function runVideo(sessionId: string, callId: string, args: ResolvedGenerateVideo, emit: Emit, signal?: AbortSignal) {
  const session = requireSession(sessionId)
  const stillRefs = uniqueHttpUrls([
    ...(args.reference_image_urls || []),
    args.first_frame_url,
    args.last_frame_url,
  ])
  const videoRefs = uniqueHttpUrls(args.reference_video_urls || [])
  const image = {
    id: callId,
    kind: 'video' as const,
    status: 'generating' as const,
    name: args.name,
    prompt: args.prompt,
    aspectRatio: args.aspect_ratio,
    resolution: args.resolution,
    url: '',
    error: '',
    sourceUrl: stillRefs[0] || videoRefs[0] || '',
    inputUrls: stillRefs,
    referenceVideoUrls: videoRefs,
    duration: args.duration,
    videoMode: (args.reference_image_urls?.length || args.reference_video_urls?.length
      ? 'reference'
      : args.first_frame_url
        ? 'image'
        : 'text') as AgentImage['videoMode'],
    videoFamily: args.family,
  }
  upsertImage(session, image)
  emit({ type: 'status', status: 'generating' })
  emit({ type: 'image', image })
  emit({ type: 'tool', name: GENERATE_VIDEO_TOOL, status: 'start', callId })
  try {
    return await withGenerationSlot(sessionId, callId, emit, signal, {
      kind: 'video',
      prompt: args.prompt,
      aspectRatio: args.aspect_ratio,
      resolution: args.resolution,
      duration: args.duration,
      sourceUrl: image.sourceUrl,
      inputUrls: stillRefs,
      referenceVideoUrls: videoRefs,
      videoMode: image.videoMode,
      videoFamily: args.family,
    }, async (bindProvider) => {
      const heartbeat = setInterval(() => {
        try {
          emit({ type: 'status', status: 'generating' })
        }
        catch {
          clearInterval(heartbeat)
        }
      }, 20000)
      try {
        const result = args.family === 'seedance-2-5'
          ? await generateSeedance25(args, undefined, rememberProviderTask(sessionId, image, bindProvider))
          : args.family === 'wan-3'
            ? await generateWan30(args, undefined, rememberProviderTask(sessionId, image, bindProvider))
            : await generateSeedance2(args, undefined, rememberProviderTask(sessionId, image, bindProvider))
        const next = {
          ...image,
          status: 'success' as const,
          url: result.urls[0] || '',
        }
        upsertImage(session, next)
        emit({ type: 'image', image: next })
        return {
          url: next.url,
          result: JSON.stringify({
            ok: true,
            taskId: result.taskId,
            name: image.name,
            urls: result.urls,
            prompt: args.prompt,
            aspect_ratio: args.aspect_ratio,
            resolution: args.resolution,
            duration: args.duration,
            family: args.family,
            first_frame_url: args.first_frame_url || '',
            reference_image_urls: args.reference_image_urls || [],
            reference_video_urls: args.reference_video_urls || [],
          }),
        }
      }
      finally {
        clearInterval(heartbeat)
      }
    })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Video generation failed'
    if (keepGeneratingOnDisconnect(sessionId, image, message, emit)) {
      return JSON.stringify({
        ok: false,
        pending: true,
        error: 'Generation continues in the background',
      })
    }
    const next = {
      ...image,
      status: 'fail' as const,
      error: message,
    }
    upsertImage(session, next)
    emit({ type: 'image', image: next })
    return JSON.stringify({
      ok: false,
      error: message,
    })
  }
  finally {
    emit({ type: 'tool', name: GENERATE_VIDEO_TOOL, status: 'end', callId })
  }
}
async function runVideos(sessionId: string, jobs: Array<{
  toolCallId: string
  args: ResolvedGenerateVideo
}>, emit: Emit, signal?: AbortSignal) {
  if (!jobs.length)
    return
  emit({ type: 'status', status: 'generating' })
  const results = await Promise.all(jobs.map(job => runVideo(sessionId, job.toolCallId, job.args, emit, signal)))
  jobs.forEach((job, index) => {
    appendToolResult(sessionId, job.toolCallId, results[index] || JSON.stringify({ ok: false, error: 'Empty tool result' }))
  })
}
async function runConcat(sessionId: string, callId: string, urls: string[], emit: Emit, signal?: AbortSignal) {
  const session = requireSession(sessionId)
  const image = {
    id: callId,
    kind: 'video' as const,
    status: 'generating' as const,
    name: 'final_film',
    prompt: `Concatenated ${urls.length} clips`,
    aspectRatio: 'auto',
    resolution: '',
    url: '',
    error: '',
    // Stitched output is model-agnostic — clips may come from mixed families.
    videoMode: 'concat' as const,
    referenceVideoUrls: urls,
  }
  upsertImage(session, image)
  emit({ type: 'status', status: 'generating' })
  emit({ type: 'image', image })
  emit({ type: 'tool', name: CONCAT_VIDEO_TOOL, status: 'start', callId })
  try {
    const url = await concatVideoUrls(urls, signal)
    const next = {
      ...image,
      status: 'success' as const,
      url,
    }
    upsertImage(session, next)
    emit({ type: 'image', image: next })
    return JSON.stringify({
      ok: true,
      name: next.name,
      urls: [url],
      video_urls: urls,
    })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Video concatenation failed'
    const next = {
      ...image,
      status: 'fail' as const,
      error: message,
    }
    upsertImage(session, next)
    emit({ type: 'image', image: next })
    return JSON.stringify({
      ok: false,
      error: message,
    })
  }
  finally {
    emit({ type: 'tool', name: CONCAT_VIDEO_TOOL, status: 'end', callId })
  }
}
async function runConcats(sessionId: string, jobs: Array<{
  toolCallId: string
  urls: string[]
}>, emit: Emit, signal?: AbortSignal) {
  if (!jobs.length)
    return
  emit({ type: 'status', status: 'generating' })
  for (const job of jobs) {
    const result = await runConcat(sessionId, job.toolCallId, job.urls, emit, signal)
    appendToolResult(sessionId, job.toolCallId, result)
  }
}
function latestUserImageUrls(messages: ChatMessage[]): string[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role !== 'user')
      continue
    if (!Array.isArray(message.content))
      return []
    return message.content
      .filter((part): part is Extract<UserContentPart, {
        type: 'image_url'
      }> => part.type === 'image_url')
      .map(part => part.image_url.url)
      .filter(url => /^https?:\/\//i.test(url) && !url.toLowerCase().startsWith('blob:'))
      .slice(0, 16)
  }
  return []
}
function withTurnImageInputs(args: GenerateImageArgs, messages: ChatMessage[]): GenerateImageArgs {
  if (args.input_urls.length)
    return args
  const attached = latestUserImageUrls(messages)
  if (!attached.length)
    return args
  return { ...args, input_urls: attached }
}
function uniqueHttpUrls(urls: Array<string | undefined>) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const url of urls) {
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url))
      continue
    seen.add(url)
    out.push(url)
  }
  return out
}
function confirmationInputUrls(imageArgs?: GenerateImageArgs, videoArgs?: ResolvedGenerateVideo, cutoutUrl?: string) {
  if (imageArgs?.input_urls.length)
    return uniqueHttpUrls(imageArgs.input_urls)
  if (videoArgs) {
    return uniqueHttpUrls([
      videoArgs.first_frame_url,
      videoArgs.last_frame_url,
      ...(videoArgs.reference_image_urls || []),
      ...(videoArgs.reference_video_urls || []),
    ])
  }
  return uniqueHttpUrls([cutoutUrl])
}
function confirmationKind(tools: string[]): ConfirmationPayload['kind'] {
  const unique = new Set(tools)
  if (unique.size > 1)
    return 'mixed'
  if (unique.has(GENERATE_VIDEO_TOOL))
    return 'video'
  if (unique.has(REMOVE_BACKGROUND_TOOL))
    return 'cutout'
  return 'image'
}
function confirmationModel(kind: ConfirmationPayload['kind'], imageArgs?: GenerateImageArgs, videoArgs?: ResolvedGenerateVideo) {
  if (kind === 'cutout')
    return { modelName: 'Image Background Removal', task: 'Remove Background' }
  if (kind === 'video') {
    const modelName = videoArgs?.family === 'seedance-2-5'
      ? 'Seedance 2.5'
      : videoArgs?.family === 'wan-3'
        ? 'Wan 3.0'
        : 'Seedance 2.0'
    const task = videoArgs?.reference_image_urls?.length || videoArgs?.reference_video_urls?.length
      ? 'Reference to Video'
      : videoArgs?.first_frame_url
        ? 'Image to Video'
        : 'Text to Video'
    return { modelName, task }
  }
  if (kind === 'mixed')
    return { modelName: 'Multiple models', task: 'Mixed jobs' }
  return {
    modelName: 'GPT Image 2',
    task: imageArgs?.input_urls.length ? 'Image to Image' : 'Text to Image',
  }
}
function queueGenerationWork(sessionId: string, items: PendingToolItem[], emit: Emit) {
  const session = requireSession(sessionId)
  const first = items[0]
  if (!first)
    return
  if (items.some(item => findAgentModelTool(item.tool))) {
    const jobs = items.map(item => ({ id: item.toolCallId, ...modelConfirmation(JSON.parse(item.argsJson) as ModelGeneration) }))
    const firstJob = jobs[0]!
    const confirmation: ConfirmationPayload = {
      id: crypto.randomUUID(),
      kind: 'mixed',
      jobs,
      count: jobs.length,
      reason: 'Review the selected models and their parameters.',
      uncertainFields: items.flatMap(item => (JSON.parse(item.argsJson) as ModelGeneration).uncertainFields),

      modelName: jobs.length === 1 ? firstJob.modelName : 'Multiple models',
      task: jobs.length === 1 ? firstJob.task : 'Mixed jobs',
      inputUrls: jobs.flatMap(job => job.inputUrls),
      params: firstJob.params,
    }
    session.pendingConfirmation = { payload: confirmation, items }
    touch(session)
    emit({ type: 'confirmation', confirmation })
    return
  }
  let imageArgs: GenerateImageArgs | undefined
  let videoArgs: ResolvedGenerateVideo | undefined
  let cutoutUrl: string | undefined
  try {
    if (first.tool === GENERATE_IMAGE_TOOL) {
      imageArgs = withTurnImageInputs(resolveGenerateImageArgs(parseGenerateImageArgs(first.argsJson), session.images), session.messages)
      first.argsJson = JSON.stringify(imageArgs)
    }
    if (first.tool === GENERATE_VIDEO_TOOL) {
      const parsed = parseGenerateVideoArgs(first.argsJson)
      videoArgs = resolveGenerateVideoArgs(clampVideoToFamily(parsed, parsed.family), session.images)
    }
    if (first.tool === REMOVE_BACKGROUND_TOOL)
      cutoutUrl = resolveRemoveBackgroundSource(parseRemoveBackgroundArgs(first.argsJson), session.images).image_url
  }
  catch {
    // Params stay generic if parsing fails; confirm still blocks generation.
  }
  const kind = confirmationKind(items.map(item => item.tool))
  const count = items.length
  const noun = kind === 'video' ? 'video' : kind === 'cutout' ? 'cutout' : kind === 'mixed' ? 'job' : 'still'
  const model = confirmationModel(kind, imageArgs, videoArgs)
  const inputUrls = confirmationInputUrls(imageArgs, videoArgs, cutoutUrl)
  const confirmation: ConfirmationPayload = {
    id: crypto.randomUUID(),
    kind,
    reason: count > 1
      ? `Confirm ${count} ${noun}s.`
      : `Confirm this ${noun}.`,
    uncertainFields: imageArgs?.uncertain_fields?.length
      ? imageArgs.uncertain_fields
      : (videoArgs?.uncertain_fields || []),
    jobs: items.map((item, index) => {
      let still: GenerateImageArgs | undefined
      let video: ResolvedGenerateVideo | undefined
      let cutout: string | undefined
      try {
        if (item.tool === GENERATE_IMAGE_TOOL)
          still = withTurnImageInputs(resolveGenerateImageArgs(parseGenerateImageArgs(item.argsJson), session.images), session.messages)
        if (item.tool === GENERATE_VIDEO_TOOL) {
          const parsed = parseGenerateVideoArgs(item.argsJson)
          video = resolveGenerateVideoArgs(clampVideoToFamily(parsed, parsed.family), session.images)
        }
        if (item.tool === REMOVE_BACKGROUND_TOOL)
          cutout = resolveRemoveBackgroundSource(parseRemoveBackgroundArgs(item.argsJson), session.images).image_url
      }
      catch {
        // Keep this task identifiable even if its arguments are invalid.
      }
      const meta = confirmationModel(confirmationKind([item.tool]), still, video)
      return {
        id: item.toolCallId,
        name: still?.name || video?.name || `Task ${index + 1}`,
        ...meta,
        inputUrls: confirmationInputUrls(still, video, cutout),
        params: {
          prompt: still?.prompt || video?.prompt || '',
          aspectRatio: still?.aspect_ratio || video?.aspect_ratio || '',
          resolution: still?.resolution || video?.resolution || '',
          duration: video?.duration,
          videoFamily: video?.family,
        },
      }
    }),
    count,

    modelName: model.modelName,
    task: model.task,
    ...(inputUrls.length ? { inputUrls } : {}),
    params: {
      prompt: imageArgs?.prompt || videoArgs?.prompt || '',
      aspectRatio: imageArgs?.aspect_ratio || videoArgs?.aspect_ratio || 'auto',
      resolution: imageArgs?.resolution || videoArgs?.resolution || '',
      duration: videoArgs?.duration,
      videoMode: videoArgs
        ? (videoArgs.reference_image_urls?.length || videoArgs.reference_video_urls?.length
            ? 'reference'
            : videoArgs.first_frame_url
              ? 'image'
              : 'text')
        : undefined,
      videoFamily: videoArgs?.family,
    },
  }
  session.pendingConfirmation = {
    payload: confirmation,
    items,
  }
  touch(session)
  emit({ type: 'confirmation', confirmation })
}
function queueAskUser(sessionId: string, items: Array<{
  toolCallId: string
  args: AskUserArgs
}>, emit: Emit) {
  const session = requireSession(sessionId)
  const first = items[0]
  if (!first)
    return
  const seen = new Set<string>()
  const questions: AskUserArgs['questions'] = []
  for (const item of items) {
    for (const question of item.args.questions) {
      const id = seen.has(question.id) ? `${question.id}_${questions.length + 1}` : question.id
      seen.add(id)
      questions.push(id === question.id ? question : { ...question, id })
    }
  }
  const intro = items.map(item => item.args.prompt).find(Boolean) || ''
  const recommendation = items.map(item => item.args.recommendation).find(Boolean) || ''
  const payload = {
    id: crypto.randomUUID(),
    prompt: intro,
    ...(recommendation ? { recommendation } : {}),
    questions,
    ...(first.args.textEdits ? { textEdits: first.args.textEdits } : {}),
    ...(first.args.textEdit ? { textEdit: first.args.textEdit } : {}),
  }
  session.pendingChoice = {
    payload,
    items: items.map(item => ({
      toolCallId: item.toolCallId,
      tool: ASK_USER_TOOL,
      argsJson: JSON.stringify(item.args),
    })),
  }
  touch(session)
  emit({ type: 'choice', choice: payload })
}
async function dispatchToolCalls(sessionId: string, toolCalls: ToolCall[], emit: Emit, signal?: AbortSignal) {
  type Prepared = {
    call: ToolCall
    kind: 'image'
    args: GenerateImageArgs
  } | {
    call: ToolCall
    kind: 'model'
    args: ModelGeneration
  } | {
    call: ToolCall
    kind: 'remove'
    source: ResolvedRemoveBackground
  } | {
    call: ToolCall
    kind: 'video'
    args: ResolvedGenerateVideo
  } | {
    call: ToolCall
    kind: 'concat'
    urls: string[]
  } | {
    call: ToolCall
    kind: 'zip'
    input: ReturnType<typeof resolveZipExport>
  } | {
    call: ToolCall
    kind: 'ask'
    args: AskUserArgs
  } | {
    call: ToolCall
    kind: 'error'
    result: string
  }
  const session = requireSession(sessionId)
  let textDetection: Promise<AskUserArgs> | undefined
  const prepared: Prepared[] = await Promise.all(toolCalls.map(async (call): Promise<Prepared> => {
    try {
      if (call.function.name === 'model_image_text_editor' && !confirmedTextEdit(session))
        return { call, kind: 'ask', args: await (textDetection ||= detectImageText(call.function.arguments, session, signal)) }
      if (findAgentModelTool(call.function.name))
        return { call, kind: 'model', args: await prepareModelGeneration(call.function.name, call.function.arguments, session) }
      if ((session.quality === 'custom' || selectedModelIds(session).length) && [GENERATE_IMAGE_TOOL, GENERATE_VIDEO_TOOL, REMOVE_BACKGROUND_TOOL].includes(call.function.name))
        throw new Error('Use the registered model tools for Custom mode or an explicitly selected model.')
      if (call.function.name === GENERATE_IMAGE_TOOL) {
        const args = withTurnImageInputs(applyImageQuality(resolveGenerateImageArgs(parseGenerateImageArgs(call.function.arguments), session.images), session.quality || 'economy'), session.messages)
        return { call, kind: 'image', args }
      }
      if (call.function.name === REMOVE_BACKGROUND_TOOL) {
        const args = parseRemoveBackgroundArgs(call.function.arguments)
        return { call, kind: 'remove', source: resolveRemoveBackgroundSource(args, session.images) }
      }
      if (call.function.name === GENERATE_VIDEO_TOOL) {
        const args = resolveGenerateVideoArgs(applyVideoQuality(parseGenerateVideoArgs(call.function.arguments), session.quality || 'economy'), session.images)
        return { call, kind: 'video', args }
      }
      if (call.function.name === EXPORT_ZIP_TOOL)
        return { call, kind: 'zip', input: resolveZipExport(call.function.arguments, session.images) }
      if (call.function.name === CONCAT_VIDEO_TOOL) {
        const args = parseConcatVideoArgs(call.function.arguments)
        return { call, kind: 'concat', urls: resolveConcatVideoUrls(args, session.images) }
      }
      if (call.function.name === ASK_USER_TOOL) {
        const args = parseAskUserArgs(call.function.arguments)
        if (args.questions.some(question => ['layer_selection_method', 'layer_split_plan'].includes(question.id)) && !hasLayerSourceImage(session.messages, session.images))
          throw new Error('No source image has been supplied. Do not show layer choices or infer image contents. Ask the user to upload an image in plain chat and wait. Show layer choices only after the image is available.')
        return { call, kind: 'ask', args }
      }
      return { call, kind: 'error', result: JSON.stringify({ ok: false, error: `Unknown tool: ${call.function.name}` }) }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Tool failed'
      return { call, kind: 'error', result: JSON.stringify({ ok: false, error: message }) }
    }
  }))
  for (const item of prepared) {
    if (item.kind === 'error')
      appendToolResult(sessionId, item.call.id, item.result)
  }
  const exports = prepared.filter((item): item is Extract<Prepared, {
    kind: 'zip'
  }> => item.kind === 'zip')
  const concats = prepared.filter((item): item is Extract<Prepared, {
    kind: 'concat'
  }> => item.kind === 'concat')
  const asks = prepared.filter((item): item is Extract<Prepared, {
    kind: 'ask'
  }> => item.kind === 'ask')
  const generation = prepared.filter((item): item is Exclude<Prepared, {
    kind: 'error' | 'concat' | 'ask' | 'zip'
  }> => item.kind === 'image' || item.kind === 'remove' || item.kind === 'video' || item.kind === 'model')
  if (asks.length) {
    const blocked = [
      ...generation.map(item => item.call.id),
      ...concats.map(item => item.call.id),
      ...exports.map(item => item.call.id),
    ]
    for (const id of blocked) {
      appendToolResult(sessionId, id, JSON.stringify({
        ok: false,
        error: 'ask_user must run alone. Wait for the user, then continue.',
      }))
    }
    if (sessionWantsStop(session)) {
      for (const item of asks) {
        appendToolResult(sessionId, item.call.id, JSON.stringify({
          ok: false,
          cancelled: true,
          error: 'Stopped by user',
        }))
      }
      return false
    }
    const editor = asks.find(item => item.args.textEdit || item.args.textEdits)
    const shownAsks = editor ? [editor] : asks
    for (const item of asks.filter(item => !shownAsks.includes(item)))
      appendToolResult(sessionId, item.call.id, JSON.stringify({ ok: false, error: 'The image text editor must run alone. Wait for its response before asking another question.' }))
    queueAskUser(sessionId, shownAsks.map(item => ({
      toolCallId: item.call.id,
      args: item.args,
    })), emit)
    return true
  }
  for (const item of exports) {
    if (sessionWantsStop(session) || signal?.aborted) {
      appendToolResult(sessionId, item.call.id, JSON.stringify({ ok: false, cancelled: true, error: 'Stopped by user' }))
      continue
    }
    emit({ type: 'tool', name: EXPORT_ZIP_TOOL, status: 'start', callId: item.call.id })
    try {
      const result = await exportSessionZip(item.input, signal)
      appendToolResult(sessionId, item.call.id, JSON.stringify(result))
    }
    catch (error) {
      appendToolResult(sessionId, item.call.id, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'ZIP export failed' }))
    }
    finally {
      emit({ type: 'tool', name: EXPORT_ZIP_TOOL, status: 'end', callId: item.call.id })
    }
  }
  if (concats.length && generation.length) {
    for (const item of concats) {
      appendToolResult(sessionId, item.call.id, JSON.stringify({
        ok: false,
        error: 'concat_videos cannot run in the same turn as generation. Finish the clips first, then concatenate.',
      }))
    }
  }
  if (generation.some(item => item.kind === 'model') && generation.some(item => item.kind !== 'model')) {
    for (const item of generation)
      appendToolResult(sessionId, item.call.id, JSON.stringify({ ok: false, error: 'Use registered model tools for all jobs in this batch.' }))
    return false
  }
  if (!generation.length && !(concats.length && !generation.length))
    return false
  if (sessionWantsStop(session)) {
    const skip = [
      ...generation.map(item => item.call.id),
      ...((concats.length && !generation.length) ? concats.map(item => item.call.id) : []),
    ]
    for (const id of skip) {
      appendToolResult(sessionId, id, JSON.stringify({
        ok: false,
        cancelled: true,
        error: 'Stopped by user',
      }))
    }
    return false
  }
  if (concats.length && !generation.length) {
    await runConcats(sessionId, concats.map(item => ({
      toolCallId: item.call.id,
      urls: item.urls,
    })), emit, signal)
    return false
  }
  if (!generation.length)
    return false
  queueGenerationWork(sessionId, generation.map((item) => {
    if (item.kind === 'model')
      return { toolCallId: item.call.id, tool: item.call.function.name, argsJson: JSON.stringify(item.args) }
    if (item.kind === 'image') {
      return {
        toolCallId: item.call.id,
        tool: GENERATE_IMAGE_TOOL,
        argsJson: JSON.stringify(item.args),
      }
    }
    if (item.kind === 'video') {
      return {
        toolCallId: item.call.id,
        tool: GENERATE_VIDEO_TOOL,
        argsJson: JSON.stringify(item.args),
      }
    }
    return {
      toolCallId: item.call.id,
      tool: REMOVE_BACKGROUND_TOOL,
      argsJson: JSON.stringify({ image_url: item.source.image_url }),
    }
  }), emit)
  return true
}
export async function runAgentLoop(sessionId: string, emit: Emit, signal?: AbortSignal) {
  const session = requireSession(sessionId)
  session.llmAbort = new AbortController()
  const onOuterAbort = () => session.llmAbort?.abort()
  if (signal?.aborted) {
    session.stopRequested = true
    noteAgentStopped(session, emit)
    return
  }
  signal?.addEventListener('abort', onOuterAbort, { once: true })
  const llmSignal = session.llmAbort.signal
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (sessionWantsStop(session) || llmSignal.aborted) {
        noteAgentStopped(session, emit)
        return
      }
      refreshSessionPrompt(session)
      const hasLayerImage = hasLayerSourceImage(session.messages, session.images)
      const missingLayerImage = !hasLayerImage && (selectedModelIds(session).includes('image-layer-splitter') || layerSplitNeedsPlan(session.messages) || needsLayerDescriptionCard(session.messages))
      const summarizeImageEdit = layerSplitNeedsSummary(session.messages, session.images) || textEditNeedsSummary(session)
      const requireLayerPlan = hasLayerImage && needsLayerDescriptionCard(session.messages)
      emit({ type: 'status', status: 'thinking' })
      const toolAcc: Array<{
        index: number
        id?: string
        name?: string
        arguments?: string
      }> = []
      let text = ''
      let reasoning = ''
      try {
        await streamChat({
          messages: summarizeImageEdit
            ? [...session.messages, { role: 'system', content: 'The requested image editing or layer splitting batch has already been submitted. Only summarize each source image’s actual result, including failures or pending jobs. Do not call tools, repeat successful edits or splits, inspect results as new source images, or retry failed images. A failed image does not authorize rerunning this batch. Wait for a new user request before any further generation.' }]
            : missingLayerImage
              ? [...session.messages, { role: 'system', content: 'The user has not supplied a source image for Image Layer Splitter. Briefly ask them to upload the image in their conversation language, then wait. Do not show choices, describe image contents, or call any tools yet. Uploading the source image must happen before layer-selection cards.' }]
              : requireLayerPlan
                ? [...session.messages, { role: 'system', content: 'The user selected Describe the layers. Your next response MUST call ask_user with one question id layer_split_plan. Inspect the supplied image and offer concrete image-specific extraction plans, plus Other with allow_custom: true. Recommend the best-fitting plan. Use the established conversation language. Do not ask for a description in ordinary text and do not repeat the method question.' }]
                : session.messages,
          requiredTool: requireLayerPlan ? ASK_USER_TOOL : undefined,
          disableTools: missingLayerImage || summarizeImageEdit,
          tools: [...openAiTools.filter(tool => !((session.quality === 'custom' || selectedModelIds(session).length) && [GENERATE_IMAGE_TOOL, GENERATE_VIDEO_TOOL, REMOVE_BACKGROUND_TOOL].includes(tool.function.name))), ...registeredModelTools],
          signal: llmSignal,
          onDelta: (delta) => {
            if (sessionWantsStop(session))
              return
            if (delta.content) {
              text += delta.content
              if (!requireLayerPlan)
                emit({ type: 'text', delta: delta.content })
            }
            if (delta.reasoning)
              reasoning += delta.reasoning
            if (delta.toolCalls?.length)
              toolAcc.push(...delta.toolCalls)
          },
        })
      }
      catch (error) {
        if (sessionWantsStop(session) || isLoopAbort(error)) {
          if (text)
            session.messages.push({ role: 'assistant', content: text })
          noteAgentStopped(session, emit)
          return
        }
        throw error
      }
      if (sessionWantsStop(session)) {
        if (text)
          session.messages.push({ role: 'assistant', content: text })
        noteAgentStopped(session, emit)
        return
      }
      void maybeEmitTitle(session.id, emit)
      // Enforce summary-only continuation even if an upstream model returns unsolicited tool calls.
      const toolCalls = summarizeImageEdit ? [] : assembleToolCalls(toolAcc)
      if (requireLayerPlan && !toolCalls.length)
        throw new Error('The layer plan card could not be created. Please retry to choose the layers; no generation was started.')
      // Tool-call preambles are planning, while a terminal response is the answer.
      if (reasoning || (toolCalls.length && text)) {
        const thinking = [reasoning, toolCalls.length ? text : ''].filter(Boolean).join('\n\n')
        text = `<think>${thinking}</think>${toolCalls.length ? '' : text}`
        emit({ type: 'text_replace', delta: text })
      }
      if (!toolCalls.length) {
        if (text)
          session.messages.push({ role: 'assistant', content: text })
        touch(session)
        return
      }
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: text || null,
        tool_calls: toolCalls,
      }
      session.messages.push(assistantMessage)
      touch(session)
      if (requireLayerPlan) {
        const valid = toolCalls.length === 1 && toolCalls[0]!.function.name === ASK_USER_TOOL && (() => {
          try {
            const args = parseAskUserArgs(toolCalls[0]!.function.arguments)
            return args.questions.length === 1 && args.questions[0]?.id === 'layer_split_plan'
          }
          catch {
            return false
          }
        })()
        if (!valid) {
          for (const call of toolCalls)
            appendToolResult(sessionId, call.id, JSON.stringify({ ok: false, error: 'Call ask_user with exactly one layer_split_plan question, concrete extraction options, and Other. Do not generate or ask the method again.' }))
          continue
        }
      }
      emit({ type: 'status', status: 'calling_tool' })
      if (sessionWantsStop(session)) {
        noteAgentStopped(session, emit)
        return
      }
      // Do not pass the loop abort into generation — already started jobs should finish.
      const paused = await dispatchToolCalls(sessionId, toolCalls, emit, undefined)
      if (sessionWantsStop(session)) {
        noteAgentStopped(session, emit)
        return
      }
      if (!paused)
        continue
      const continued = await tryServerAutoConfirm(sessionId, emit, undefined)
      if (sessionWantsStop(session)) {
        noteAgentStopped(session, emit)
        return
      }
      if (continued)
        continue
      return
    }
    session.messages.push({
      role: 'assistant',
      content: 'I reached the step limit for this turn. Send another message to continue.',
    })
  }
  finally {
    signal?.removeEventListener('abort', onOuterAbort)
    session.llmAbort = undefined
  }
}
function parseAttachmentUrls(value: unknown) {
  if (!Array.isArray(value))
    return []
  const urls = value.map(item => typeof item === 'string' ? item.trim() : '').filter(url => /^https?:\/\//i.test(url) && !url.toLowerCase().startsWith('blob:'))
  if (urls.length > 16)
    throw new Error('A maximum of 16 attached images is allowed')
  return urls
}
function userMessageContent(text: string, attachments: string[]): string | UserContentPart[] {
  if (!attachments.length)
    return text
  const body = text || 'Use the attached still(s).'
  const listed = `${body}\n\nAttached stills:\n${attachments.map((url, index) => `${index + 1}. ${url}`).join('\n')}\nUse these URLs as generate_image input_urls, generate_video first_frame (one still), or generate_video reference_images (several stills).`
  return [
    { type: 'text', text: listed },
    ...attachments.map(url => ({ type: 'image_url' as const, image_url: { url } })),
  ]
}
function emitSessionCatchUp(session: {
  images: AgentImage[]
}, emit: Emit) {
  for (const image of session.images) {
    if (image.status === 'generating' || image.status === 'fail' || image.url)
      emit({ type: 'image', image, replay: true })
  }
}
export async function handleStop(sessionId: string) {
  const session = await requireLoadedSession(sessionId)
  session.stopRequested = true
  session.llmAbort?.abort()
  if (session.pendingConfirmation && !confirmationAlreadyStarted(session)) {
    for (const item of session.pendingConfirmation.items) {
      appendToolResult(session.id, item.toolCallId, JSON.stringify({
        ok: false,
        cancelled: true,
        error: 'Stopped by user',
      }))
    }
    session.pendingConfirmation = null
  }
  if (session.pendingChoice && !choiceAlreadyAnswered(session)) {
    for (const item of session.pendingChoice.items) {
      appendToolResult(session.id, item.toolCallId, JSON.stringify({
        ok: false,
        cancelled: true,
        error: 'Stopped by user',
      }))
    }
    session.pendingChoice = null
  }
  noteAgentStopped(session)
  return { ok: true as const, sessionId: session.id, busy: Boolean(session.busy) }
}
export async function handleChat(message: string, sessionId: string | undefined, attachments: unknown, emit: Emit, signal?: AbortSignal, quality?: unknown, confirmPolicy?: unknown, options?: LoopRequestOptions) {
  const urls = parseAttachmentUrls(attachments)
  const text = message.trim()
  if (!text && !urls.length)
    throw new Error('Message is required')
  const session = await resolveChatSession(sessionId, options?.projectId, options?.bffUrl)
  if (readModelMentions(text).length)
    session.quality = 'custom'
  else if (quality !== undefined)
    session.quality = parseAgentQuality(quality)
  session.confirmPolicy = parseAgentConfirmPolicy(confirmPolicy)
  session.stopRequested = false
  if (options?.projectId)
    session.projectId = options.projectId
  if (options?.bffUrl)
    session.bffUrl = options.bffUrl
  await restoreSessionContext(session, options?.history, options?.images, text)
  refreshSessionPrompt(session)
  emit({ type: 'session', sessionId: session.id })
  emitSessionCatchUp(session, emit)
  if (session.busy)
    throw new Error('This session is already running')
  if (session.pendingConfirmation) {
    // Re-attach the card so the client can confirm without another round-trip.
    emit({ type: 'confirmation', confirmation: session.pendingConfirmation.payload })
    throw new Error('Confirm or cancel the pending generation first')
  }
  if (session.pendingChoice) {
    emit({ type: 'choice', choice: session.pendingChoice.payload })
    throw new Error('Answer or skip the pending questions first')
  }
  session.busy = true
  session.messages.push({ role: 'user', content: userMessageContent(text, urls) })
  touch(session)
  try {
    await runAgentLoop(session.id, emit, signal)
  }
  finally {
    session.busy = false
    touch(session)
    if (!session.pendingConfirmation && !session.pendingChoice)
      emit({ type: 'status', status: 'idle' })
    emit({ type: 'done' })
  }
}
function storedVideoArgs(argsJson: string, images: ReturnType<typeof requireSession>['images'], params?: ConfirmBody['params']): ResolvedGenerateVideo {
  const previous = JSON.parse(argsJson) as Record<string, unknown>
  const args = parseGenerateVideoArgs(JSON.stringify({
    name: previous.name,
    prompt: params?.prompt ?? previous.prompt,
    aspect_ratio: params?.aspectRatio ?? previous.aspect_ratio,
    resolution: params?.resolution ?? previous.resolution,
    duration: params?.duration ?? previous.duration,
    generate_audio: previous.generate_audio,
    first_frame: previous.first_frame || previous.first_frame_url || '',
    last_frame: previous.last_frame || previous.last_frame_url || '',
    reference_images: previous.reference_images || previous.reference_image_urls || [],
    reference_videos: previous.reference_videos || previous.reference_video_urls || [],
    family: parseVideoFamily(previous.family),
  }))
  return resolveGenerateVideoArgs(clampVideoToFamily(args, args.family), images)
}
async function runConfirmedItems(sessionId: string, items: PendingToolItem[], body: ConfirmBody, emit: Emit, signal?: AbortSignal) {
  const session = requireSession(sessionId)
  const sameTool = items.every(item => item.tool === items[0]?.tool)
  const applyParams = sameTool && items.length === 1 ? body.params : undefined
  const models: Array<{
    toolCallId: string
    args: ModelGeneration
  }> = []
  const images: Array<{
    toolCallId: string
    args: GenerateImageArgs
  }> = []
  const videos: Array<{
    toolCallId: string
    args: ResolvedGenerateVideo
  }> = []
  const removals: Array<{
    toolCallId: string
    source: ResolvedRemoveBackground
  }> = []
  for (const item of items) {
    const tool = item.tool || GENERATE_IMAGE_TOOL
    if (findAgentModelTool(tool)) {
      models.push({ toolCallId: item.toolCallId, args: JSON.parse(item.argsJson) as ModelGeneration })
      continue
    }
    if (tool === GENERATE_IMAGE_TOOL) {
      const previous = JSON.parse(item.argsJson) as GenerateImageArgs
      const args = parseGenerateImageArgs(JSON.stringify({
        name: previous.name,
        prompt: items.length === 1
          ? (applyParams?.prompt ?? previous.prompt)
          : previous.prompt,
        aspect_ratio: applyParams?.aspectRatio ?? previous.aspect_ratio,
        resolution: applyParams?.resolution ?? previous.resolution,
        input_urls: previous.input_urls || [],
        uncertain_fields: [],
        reason: '',
      }))
      images.push({ toolCallId: item.toolCallId, args: resolveGenerateImageArgs(args, session.images) })
      continue
    }
    if (tool === GENERATE_VIDEO_TOOL) {
      videos.push({
        toolCallId: item.toolCallId,
        args: storedVideoArgs(item.argsJson, session.images, items.length === 1 ? applyParams : undefined),
      })
      continue
    }
    if (tool === REMOVE_BACKGROUND_TOOL) {
      const previous = JSON.parse(item.argsJson) as {
        image_url?: string
      }
      removals.push({
        toolCallId: item.toolCallId,
        source: resolveRemoveBackgroundSource({ image_url: String(previous.image_url || 'latest') }, session.images),
      })
    }
  }
  await Promise.all([
    ...models.map(async (job) => {
      const result = await runModelGeneration(session, job.toolCallId, job.args, emit)
      appendToolResult(sessionId, job.toolCallId, result)
      if (items.find(item => item.toolCallId === job.toolCallId)?.tool !== 'model_image_text_editor' && job.args.modelId !== 'image-layer-splitter' && AGENT_MODELS.find(model => model.id === job.args.modelId)?.category === 'Image')
        inspectGeneratedStills(sessionId, successfulUrls([result]))
    }),
    runGenerations(sessionId, images, emit, signal),
    runRemovals(sessionId, removals, emit, signal),
    runVideos(sessionId, videos, emit, signal),
  ])
}
export async function handleConfirm(sessionId: string, body: ConfirmBody, emit: Emit, signal?: AbortSignal, options?: LoopRequestOptions) {
  const session = await requireLoadedSession(sessionId, options?.bffUrl)
  if (options?.projectId)
    session.projectId = options.projectId
  if (options?.bffUrl)
    session.bffUrl = options.bffUrl
  emit({ type: 'session', sessionId: session.id })
  emitSessionCatchUp(session, emit)
  if (session.busy)
    throw new Error('This session is already running')
  const pending = session.pendingConfirmation
  if (!pending || pending.payload.id !== body.confirmationId)
    throw new Error('No matching confirmation')
  if (body.action === 'confirm' && confirmationAlreadyStarted(session, pending.items)) {
    session.pendingConfirmation = null
    touch(session)
    scheduleSessionResume(session)
    emit({ type: 'status', status: session.images.some(item => item.status === 'generating') ? 'generating' : 'idle' })
    emit({ type: 'done' })
    return
  }
  session.busy = true
  session.pendingConfirmation = null
  touch(session)
  try {
    if (body.action === 'confirm') {
      await runConfirmedItems(session.id, pending.items, body, emit, signal)
      touch(session)
      if (!sessionWantsStop(session))
        await runAgentLoop(session.id, emit, signal)
      else
        noteAgentStopped(session, emit)
    }
    else {
      const error = body.action === 'abort'
        ? 'Generation aborted'
        : 'User cancelled generation'
      for (const item of pending.items) {
        appendToolResult(sessionId, item.toolCallId, JSON.stringify({
          ok: false,
          cancelled: body.action === 'cancel',
          error,
        }))
      }
      touch(session)
      if (body.action === 'cancel' && !sessionWantsStop(session))
        await runAgentLoop(session.id, emit, signal)
    }
  }
  finally {
    session.busy = false
    touch(session)
    // Keep the client from treating a waiting confirmation as a finished turn.
    if (!session.pendingConfirmation && !session.pendingChoice)
      emit({ type: 'status', status: 'idle' })
    emit({ type: 'done' })
  }
}
function formatChoiceResult(payload: NonNullable<AgentSession['pendingChoice']>['payload'], body: ChoiceBody, sourceUrls: string[] = []) {
  if (payload.textEdit || payload.textEdits) {
    if (body.action === 'skip')
      return JSON.stringify({ ok: true, skipped: true, message: 'Text editing cancelled. Do not generate or reopen the editor unless the user asks.' })
    if (payload.textEdits) {
      const textEdits = validateTextEditAnswers(payload.textEdits, body.answers?.find(answer => answer.questionId === 'image_text_editor')?.textEdits, sourceUrls)
      return JSON.stringify({ ok: true, textEdits, message: 'User confirmed these image-specific edits. Submit exactly one job per edited image using its own source and text.' })
    }
    const textEdit = validateTextEditAnswer(payload.textEdit!, body.answers?.find(answer => answer.questionId === 'image_text_editor')?.textLines, sourceUrls)
    return JSON.stringify({ ok: true, textEdit, message: 'User confirmed these exact edits. Call model_image_text_editor now to generate them. Do not change the confirmed text or approximate locations.' })
  }
  if (body.action === 'skip') {
    return JSON.stringify({
      ok: true,
      skipped: true,
      message: 'User skipped. Decide using your recommendation. Do not ask these questions again.',
    })
  }
  const incoming = Array.isArray(body.answers) ? body.answers : []
  const byId = new Map(incoming.map(item => [item.questionId, item]))
  const answers: ChoiceAnswer[] = payload.questions.map((question) => {
    const row = byId.get(question.id)
    if (!row || row.skipped) {
      return {
        questionId: question.id,
        skipped: true,
      }
    }
    const option = withCustomChoiceOption(question.options).find(item => item.id === row.optionId)
    const text = String(row.text || '').trim().slice(0, 500)
    if (option?.custom) {
      return {
        questionId: question.id,
        optionId: option.id,
        label: option.label,
        text,
        skipped: !text,
      }
    }
    if (option) {
      const selection = question.id === 'layer_selection_method' && option.id === 'draw_boxes'
        ? row.imageSelections !== undefined
          ? { imageSelections: validateLayerSelections(row.imageSelections, sourceUrls) }
          : validateLayerSelection(row.imageUrl, row.regions, sourceUrls)
        : undefined
      return {
        questionId: question.id,
        optionId: option.id,
        label: option.label,
        ...(text ? { text } : {}),
        ...selection,
      }
    }
    if (text) {
      return {
        questionId: question.id,
        text,
      }
    }
    return {
      questionId: question.id,
      skipped: true,
    }
  })
  return JSON.stringify({
    ok: true,
    skipped: answers.every(item => item.skipped),
    answers,
  })
}
export async function handleChoice(sessionId: string, body: ChoiceBody, emit: Emit, signal?: AbortSignal, options?: LoopRequestOptions) {
  const session = await requireLoadedSession(sessionId, options?.bffUrl)
  if (options?.projectId)
    session.projectId = options.projectId
  if (options?.bffUrl)
    session.bffUrl = options.bffUrl
  emit({ type: 'session', sessionId: session.id })
  emitSessionCatchUp(session, emit)
  if (session.busy)
    throw new Error('This session is already running')
  const pending = session.pendingChoice
  if (!pending || pending.payload.id !== body.choiceId)
    throw new Error('No matching questions')
  if (choiceAlreadyAnswered(session, pending.items)) {
    session.pendingChoice = null
    touch(session)
    emit({ type: 'status', status: session.images.some(item => item.status === 'generating') ? 'generating' : 'idle' })
    emit({ type: 'done' })
    return
  }
  const result = formatChoiceResult(pending.payload, body, session.images.filter(image => image.status === 'success' && image.kind !== 'video' && image.url).map(image => image.url!))
  session.busy = true
  session.pendingChoice = null
  session.stopRequested = false
  touch(session)
  try {
    const preference = modelPreferenceFromChoice(pending.payload, body)
    if (preference) {
      session.quality = preference
      refreshSessionPrompt(session)
    }
    for (const item of pending.items)
      appendToolResult(session.id, item.toolCallId, result)
    touch(session)
    const confirmed = JSON.parse(result) as {
      answers?: ChoiceAnswer[]
      textEdit?: {
        imageUrl: string
      }
      textEdits?: {
        imageUrl: string
      }[]
    }
    const textEdits = confirmed.textEdits || (confirmed.textEdit ? [confirmed.textEdit] : [])
    const layerImages = confirmed.answers?.find(answer => answer.questionId === 'layer_selection_method' && answer.optionId === 'draw_boxes')?.imageSelections
    if ((layerImages?.length || textEdits.length) && !sessionWantsStop(session)) {
      // Confirmed edits already define the request; enqueue them without another planning turn.
      const toolCalls: ToolCall[] = textEdits.length
        ? textEdits.map(edit => ({ id: crypto.randomUUID(), type: 'function', function: { name: 'model_image_text_editor', arguments: JSON.stringify({ image_url: edit.imageUrl }) } }))
        : (layerImages || []).map((selection, index) => ({
            id: crypto.randomUUID(),
            type: 'function',
            function: {
              name: 'model_image_layer_splitter',
              arguments: JSON.stringify({ image_url: selection.imageUrl, regions: selection.regions, _name: `Image Layer Splitter ${index + 1}` }),
            },
          }))
      session.messages.push({ role: 'assistant', content: '', tool_calls: toolCalls })
      touch(session)
      const paused = await dispatchToolCalls(session.id, toolCalls, emit, signal)
      if (paused && !await tryServerAutoConfirm(session.id, emit, signal))
        return
    }
    if (!sessionWantsStop(session))
      await runAgentLoop(session.id, emit, signal)
    else
      noteAgentStopped(session, emit)
  }
  finally {
    session.busy = false
    touch(session)
    if (!session.pendingConfirmation && !session.pendingChoice)
      emit({ type: 'status', status: 'idle' })
    emit({ type: 'done' })
  }
}
export async function handleUpload(sessionId: string | undefined, file: {
  bytes: Uint8Array
  fileName: string
  mime: string
}) {
  const session = await resolveChatSession(sessionId)
  const url = await uploadAgentImage(session.id, file)
  const image = {
    id: crypto.randomUUID(),
    kind: 'upload' as const,
    status: 'success' as const,
    prompt: 'Uploaded still',
    aspectRatio: 'auto',
    resolution: '',
    url,
    error: '',
  }
  upsertImage(session, image)
  return { sessionId: session.id, image }
}
