const YOUTUBE_PATTERNS = [
  /(?:youtube\.com\/watch\?v=|youtube\.com\/watch\?.*&v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]{11})/i,
  /^([\w-]{11})$/,
]

export function parseYoutubeVideoId(input: string) {
  const value = String(input || '').trim()
  if (!value)
    return null

  for (const pattern of YOUTUBE_PATTERNS) {
    const match = pattern.exec(value)
    if (match?.[1])
      return match[1]
  }

  return null
}

export function youtubeEmbedUrl(videoId: string) {
  return `https://www.youtube.com/embed/${videoId}`
}

export function isYoutubeEmbedUrl(src: string) {
  return /^https:\/\/(www\.)?youtube(-nocookie)?\.com\/embed\/[\w-]{11}(?:\?|$)/i.test(src.trim())
}
