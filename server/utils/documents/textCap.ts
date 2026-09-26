import { DOCUMENT_TEXT_CHAR_CAP } from './limits'

export function capText(text: string, cap = DOCUMENT_TEXT_CHAR_CAP) {
  const value = String(text || '')
  if (value.length <= cap)
    return { text: value, truncated: false, nextHint: '' }
  return {
    text: value.slice(0, cap),
    truncated: true,
    nextHint: `Output truncated at ${cap} characters. Request the next range to continue.`,
  }
}
