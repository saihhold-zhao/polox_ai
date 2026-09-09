export function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function requireString(value: unknown, field: string) {
  const text = asString(value)
  if (!text) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} is required`,
    })
  }
  return text
}

export function asBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean')
    return value
  return fallback
}

export function firstHttpUrl(value: unknown, field: string, required: boolean) {
  if (typeof value === 'string') {
    const url = asString(value)
    if (url) {
      if (!/^https?:\/\//i.test(url) || url.startsWith('blob:')) {
        throw createError({
          statusCode: 400,
          statusMessage: `${field} must be a public HTTP URL`,
        })
      }
      return url
    }
  }

  if (Array.isArray(value)) {
    const urls = value.map(item => asString(item)).filter(Boolean)
    if (urls.length > 1) {
      throw createError({
        statusCode: 400,
        statusMessage: `${field} accepts one file`,
      })
    }
    if (urls[0]) {
      if (!/^https?:\/\//i.test(urls[0]) || urls[0].startsWith('blob:')) {
        throw createError({
          statusCode: 400,
          statusMessage: `${field} must be a public HTTP URL`,
        })
      }
      return urls[0]
    }
  }

  if (required) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} is required`,
    })
  }

  return ''
}

export function sanitizeUrlList(value: unknown, field: string, maxItems: number) {
  if (value == null || value === '')
    return []

  if (!Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be an array of URLs`,
    })
  }

  if (value.length > maxItems) {
    throw createError({
      statusCode: 400,
      statusMessage: `A maximum of ${maxItems} files is allowed for ${field}`,
    })
  }

  return value.map((item, index) => {
    const url = asString(item)
    if (!/^https?:\/\//i.test(url) || url.startsWith('blob:')) {
      throw createError({
        statusCode: 400,
        statusMessage: `${field}[${index}] must be a public HTTP URL`,
      })
    }
    return url
  })
}
