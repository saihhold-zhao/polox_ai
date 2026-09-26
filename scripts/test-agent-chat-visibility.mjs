import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const nodeRequire = createRequire(import.meta.url)

function load(file) {
  const module = { exports: {} }
  const source = readFileSync(file, 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, require: nodeRequire }, { filename: file })
  return module.exports
}

const { publicAgentChatText, isInternalAgentChatText, isAutoRetryUserInstruction, INTERNAL_AUTO_RETRY_MARKER } = load(resolve(root, 'shared/utils/agentChatVisibility.ts'))

test('document attach-only protocol is hidden like other media', () => {
  const legacy = 'Use the attached document(s) via document_meta / document_text / document_search (do not paste full file text).\n\nAttached documents:\n1. brief.xlsx — https://example.com/brief.xlsx\nUse document_meta, document_text (ranged: pageFrom/pageTo for PDF, chunkFrom/chunkTo for Word, slideFrom/slideTo for PPT), document_search, document_page_image (PDF page or PPTX slide preview), or document_images (DOCX/PPTX embeds). Never dump the entire file into the chat.'
  const soft = 'Use the attached document(s).\n\nAttached documents:\n1. brief.xlsx — https://example.com/brief.xlsx\nThese URLs are available via document_meta, document_text (ranged: pageFrom/pageTo for PDF, chunkFrom/chunkTo for Word, slideFrom/slideTo for PPT), document_search, document_page_image (PDF page or PPTX slide preview), or document_images (DOCX/PPTX embeds). Use them only when the user asks about the document; do not proactively summarize or dump the file.'
  const current = 'The user attached document(s) with no task. Acknowledge the file name(s) and ask what they need. Do not call any document_* tool this turn.\n\nAttached documents:\n1. brief.xlsx — https://example.com/brief.xlsx\nThese URLs are available via document_meta, document_text (ranged: pageFrom/pageTo for PDF, chunkFrom/chunkTo for Word, slideFrom/slideTo for PPT), document_search, document_page_image (PDF page or PPTX slide preview), or document_images (DOCX/PPTX embeds). Ask-first: if this turn has no concrete document task (attach-only or vague look-over), acknowledge the file name(s) and ask what they need — call zero document_* tools. Only after a concrete ask, use the tools. Never dump the entire file into chat.'
  assert.equal(publicAgentChatText(legacy), '')
  assert.equal(publicAgentChatText(soft), '')
  assert.equal(publicAgentChatText(current), '')
  assert.equal(isInternalAgentChatText(legacy), true)
  assert.equal(isInternalAgentChatText(soft), true)
  assert.equal(isInternalAgentChatText(current), true)
  // Human prompt comes before the attach protocol (same shape as stills/video/voice).
  const withAsk = `What is in sheet 1?\n\nAttached documents:\n1. brief.xlsx — https://example.com/brief.xlsx\nThese URLs are available via document_meta, document_text. Ask-first: if this turn has no concrete document task, acknowledge the file name(s) and ask what they need — call zero document_* tools.`
  assert.equal(publicAgentChatText(withAsk), 'What is in sheet 1?')
  assert.equal(isInternalAgentChatText(withAsk), false)
})

test('auto-retry synthetic user turns are hidden from chat UI', () => {
  const marked = `${INTERNAL_AUTO_RETRY_MARKER}\nSome shots just failed. Retry only the failed shots with the same reference images, duration, aspect ratio, and prompts. Do not remake the whole film.\n- Shot 1 prompt (timeout)`
  const legacyZh = '刚才有镜头失败了。请只重试失败的镜头，使用相同的参考图、时长、比例和提示词，不要重拍整部片子。\n- Shot 1'
  const legacyEn = 'A shot just failed (reason: timeout). Retry only that failed shot with the same reference images, duration, aspect ratio, and prompt. Do not remake the whole film. Failed shot: close-up'
  assert.equal(isAutoRetryUserInstruction(marked), true)
  assert.equal(isAutoRetryUserInstruction(legacyZh), true)
  assert.equal(isAutoRetryUserInstruction(legacyEn), true)
  assert.equal(publicAgentChatText(marked), '')
  assert.equal(publicAgentChatText(legacyZh), '')
  assert.equal(publicAgentChatText(legacyEn), '')
  assert.equal(isInternalAgentChatText(marked), true)
  assert.equal(isInternalAgentChatText(legacyZh), true)
  assert.equal(isInternalAgentChatText(legacyEn), true)
  assert.equal(isAutoRetryUserInstruction('Please retry shot 3 for me'), false)
  assert.equal(publicAgentChatText('Please retry shot 3 for me'), 'Please retry shot 3 for me')
})
