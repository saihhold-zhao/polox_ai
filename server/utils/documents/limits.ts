/** Document upload + tool limits for AgentLab. */

/** 40 MB per document upload (PDF / Office / CSV). */
export const DOCUMENT_MAX_BYTES = 40 * 1024 * 1024

/** Soft cap on characters returned by document_text / document_search. */
export const DOCUMENT_TEXT_CHAR_CAP = 20_000

export const DOCUMENT_PDF_PAGES_PER_CALL = 8
export const DOCUMENT_PDF_PAGES_HARD_MAX = 12
export const DOCUMENT_WORD_CHUNK_CHARS = 4_000
export const DOCUMENT_WORD_CHUNKS_PER_CALL = 4
export const DOCUMENT_PPT_SLIDES_PER_CALL = 8
export const DOCUMENT_EXCEL_MAX_ROWS = 200
export const DOCUMENT_EXCEL_MAX_COLS = 40
export const DOCUMENT_SEARCH_MAX_HITS = 20
export const DOCUMENT_PAGE_IMAGE_SCALE = 1.5
export const DOCUMENT_EMBEDDED_IMAGES_MAX = 12
