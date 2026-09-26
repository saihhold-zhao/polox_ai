export type DocumentFormat = 'pdf' | 'docx' | 'doc' | 'pptx' | 'ppt' | 'xlsx' | 'xls' | 'csv'

const MIME_TO_FORMAT: Record<string, DocumentFormat> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
  'application/csv': 'csv',
}

const EXT_TO_FORMAT: Record<string, DocumentFormat> = {
  pdf: 'pdf',
  doc: 'doc',
  docx: 'docx',
  ppt: 'ppt',
  pptx: 'pptx',
  xls: 'xls',
  xlsx: 'xlsx',
  csv: 'csv',
}

export const DOCUMENT_MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
  'application/csv': 'csv',
}

export function normalizeMime(mime: string) {
  return String(mime || '').toLowerCase().split(';')[0]!.trim()
}

export function documentFormatForMime(mime: string): DocumentFormat | null {
  return MIME_TO_FORMAT[normalizeMime(mime)] || null
}

export function documentFormatForName(fileName: string): DocumentFormat | null {
  const ext = String(fileName || '').split('.').pop()?.toLowerCase() || ''
  return EXT_TO_FORMAT[ext] || null
}

export function documentFormatForMimeOrName(mime: string, fileName = ''): DocumentFormat | null {
  return documentFormatForMime(mime) || documentFormatForName(fileName)
}

export function isLegacyOfficeFormat(format: DocumentFormat) {
  return format === 'doc' || format === 'ppt' || format === 'xls'
}

export function legacyOfficeMessage(format: DocumentFormat | string) {
  if (format === 'doc')
    return 'Legacy .doc is not supported. Please convert to .docx and re-upload.'
  if (format === 'ppt')
    return 'Legacy .ppt is not supported. Please convert to .pptx and re-upload.'
  if (format === 'xls')
    return 'Legacy .xls is not supported. Please convert to .xlsx (or CSV) and re-upload.'
  return 'This legacy Office format is not supported. Convert to OOXML (.docx/.pptx/.xlsx) and re-upload.'
}
