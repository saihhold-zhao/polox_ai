import {
  DOCUMENT_EXCEL_MAX_COLS,
  DOCUMENT_EXCEL_MAX_ROWS,
} from './limits'
import { capText } from './textCap'

function sheetToMatrix(sheet: any) {
  const rows: string[][] = []
  sheet.eachRow({ includeEmpty: false }, (row: any) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : []
    rows.push(values.map((cell: unknown) => {
      if (cell == null)
        return ''
      if (typeof cell === 'object' && cell && 'text' in (cell as any))
        return String((cell as any).text ?? '')
      if (typeof cell === 'object' && cell && 'result' in (cell as any))
        return String((cell as any).result ?? '')
      return String(cell)
    }))
  })
  return rows
}

export async function xlsxMeta(bytes: Uint8Array, fileName = '') {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(bytes) as any)
  const sheets = workbook.worksheets.map((sheet) => {
    const matrix = sheetToMatrix(sheet)
    return {
      name: sheet.name,
      rowCount: matrix.length,
      columnCount: matrix.reduce((max, row) => Math.max(max, row.length), 0),
    }
  })
  return {
    format: 'xlsx' as const,
    title: fileName.replace(/\.xlsx$/i, '') || '',
    sheetCount: sheets.length,
    sheets,
    hasText: sheets.some(sheet => sheet.rowCount > 0),
  }
}

export async function xlsxText(bytes: Uint8Array, sheetName?: string, rowFrom = 1, rowTo?: number) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(bytes) as any)
  const sheet = sheetName
    ? workbook.getWorksheet(sheetName) || workbook.worksheets.find(item => item.name.toLowerCase() === sheetName.toLowerCase())
    : workbook.worksheets[0]
  if (!sheet)
    throw new Error(sheetName ? `Sheet not found: ${sheetName}` : 'Workbook has no sheets')
  const matrix = sheetToMatrix(sheet)
  const from = Math.max(1, Math.floor(rowFrom || 1))
  const requestedTo = rowTo == null ? from + DOCUMENT_EXCEL_MAX_ROWS - 1 : Math.floor(rowTo)
  const to = Math.min(matrix.length, Math.max(from, requestedTo), from + DOCUMENT_EXCEL_MAX_ROWS - 1)
  if (from > matrix.length)
    throw new Error(`rowFrom ${from} is past the end (${matrix.length} rows)`)
  const slice = matrix.slice(from - 1, to).map((row, index) => ({
    row: from + index,
    cells: row.slice(0, DOCUMENT_EXCEL_MAX_COLS),
  }))
  const header = `sheet=${sheet.name}\trows=${from}-${to}/${matrix.length}\tcols<=${DOCUMENT_EXCEL_MAX_COLS}`
  const capped = capText([header, ...slice.map(item => `${item.row}\t${item.cells.join('\t')}`)].join('\n'))
  return {
    format: 'xlsx' as const,
    sheet: sheet.name,
    rowFrom: from,
    rowTo: to,
    rowCount: matrix.length,
    columnCount: matrix.reduce((max, row) => Math.max(max, row.length), 0),
    rows: slice,
    text: capped.text,
    truncated: capped.truncated,
    nextHint: capped.truncated
      ? capped.nextHint
      : (to < matrix.length ? `More rows remain. Call again with rowFrom=${to + 1}.` : ''),
  }
}

export async function xlsxSearch(bytes: Uint8Array, query: string, maxHits: number) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(bytes) as any)
  const needle = query.trim().toLowerCase()
  if (!needle)
    throw new Error('query is required')
  const hits: Array<{ sheet: string, row: number, column: number, snippet: string }> = []
  for (const sheet of workbook.worksheets) {
    const matrix = sheetToMatrix(sheet)
    for (let r = 0; r < matrix.length; r++) {
      const row = matrix[r] || []
      for (let c = 0; c < row.length; c++) {
        const cell = row[c] || ''
        if (!cell.toLowerCase().includes(needle))
          continue
        hits.push({ sheet: sheet.name, row: r + 1, column: c + 1, snippet: cell.slice(0, 220) })
        if (hits.length >= maxHits)
          return { format: 'xlsx' as const, query, hits, hitCount: hits.length }
      }
    }
  }
  return { format: 'xlsx' as const, query, hits, hitCount: hits.length }
}

export async function csvMeta(bytes: Uint8Array, fileName = '') {
  const text = Buffer.from(bytes).toString('utf8')
  const lines = text.split(/\r?\n/).filter(line => line.length > 0)
  return {
    format: 'csv' as const,
    title: fileName.replace(/\.csv$/i, '') || '',
    sheetCount: 1,
    sheets: [{ name: 'Sheet1', rowCount: lines.length, columnCount: lines[0] ? lines[0].split(',').length : 0 }],
    hasText: lines.length > 0,
  }
}

export async function csvText(bytes: Uint8Array, rowFrom = 1, rowTo?: number) {
  const lines = Buffer.from(bytes).toString('utf8').split(/\r?\n/)
  const from = Math.max(1, Math.floor(rowFrom || 1))
  const requestedTo = rowTo == null ? from + DOCUMENT_EXCEL_MAX_ROWS - 1 : Math.floor(rowTo)
  const to = Math.min(lines.length, Math.max(from, requestedTo), from + DOCUMENT_EXCEL_MAX_ROWS - 1)
  if (from > lines.length)
    throw new Error(`rowFrom ${from} is past the end (${lines.length} rows)`)
  const slice = lines.slice(from - 1, to)
  const capped = capText(slice.map((line, index) => `${from + index}\t${line}`).join('\n'))
  return {
    format: 'csv' as const,
    sheet: 'Sheet1',
    rowFrom: from,
    rowTo: to,
    rowCount: lines.length,
    text: capped.text,
    truncated: capped.truncated,
    nextHint: capped.truncated
      ? capped.nextHint
      : (to < lines.length ? `More rows remain. Call again with rowFrom=${to + 1}.` : ''),
  }
}

export async function csvSearch(bytes: Uint8Array, query: string, maxHits: number) {
  const lines = Buffer.from(bytes).toString('utf8').split(/\r?\n/)
  const needle = query.trim().toLowerCase()
  if (!needle)
    throw new Error('query is required')
  const hits: Array<{ sheet: string, row: number, snippet: string }> = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] || ''
    if (!line.toLowerCase().includes(needle))
      continue
    hits.push({ sheet: 'Sheet1', row: index + 1, snippet: line.slice(0, 220) })
    if (hits.length >= maxHits)
      break
  }
  return { format: 'csv' as const, query, hits, hitCount: hits.length }
}
