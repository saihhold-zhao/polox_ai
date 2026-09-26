/**
 * Regression: clampVideoToFamily / parse must tolerate missing optional ref arrays.
 * Run: node scripts/check-generate-video-refs.mjs
 */
function asVideoRefList(value) {
  return Array.isArray(value) ? value : []
}

function clampVideoToFamily(args, family) {
  const referenceImages = asVideoRefList(args.reference_images)
  const referenceVideos = asVideoRefList(args.reference_videos)
  const referenceAudios = asVideoRefList(args.reference_audios)

  if (family === 'wan-3') {
    const hasRefs = Boolean(referenceImages.length || referenceVideos.length || referenceAudios.length)
    return {
      ...args,
      family,
      reference_images: referenceImages.slice(0, 10),
      reference_videos: referenceVideos.slice(0, 5),
      reference_audios: referenceAudios.slice(0, 5),
      _hasRefs: hasRefs,
    }
  }
  return {
    ...args,
    family,
    reference_images: referenceImages.slice(0, 9),
    reference_videos: referenceVideos.slice(0, 3),
    reference_audios: referenceAudios.slice(0, 3),
  }
}

function asStringList(value) {
  if (!Array.isArray(value)) return []
  return value.map(String).filter(Boolean)
}

function parseGenerateVideoArgs(raw) {
  const parsed = JSON.parse(raw)
  return {
    prompt: String(parsed.prompt || ''),
    reference_images: asStringList(parsed.reference_images ?? parsed.reference_image_urls),
    reference_videos: asStringList(parsed.reference_videos ?? parsed.reference_video_urls),
    reference_audios: asStringList(parsed.reference_audios ?? parsed.reference_audio_urls),
    first_frame: String(parsed.first_frame || ''),
    duration: 5,
    resolution: '480p',
    aspect_ratio: '9:16',
  }
}

const cases = [
  ['motion-copy omit audios', '{"prompt":"Woman walking with graceful bounce","reference_images":["https://x/a.jpg"],"reference_videos":["https://x/b.mp4"],"aspect_ratio":"9:16","duration":5,"generate_audio":false}'],
  ['omit all refs', '{"prompt":"Woman walking with graceful bounce","duration":5}'],
  ['explicit null refs', '{"prompt":"test prompt ok","reference_images":null,"reference_videos":null,"reference_audios":null}'],
]

let failed = 0
for (const [name, raw] of cases) {
  try {
    const parsed = parseGenerateVideoArgs(raw)
    for (const family of ['seedance-2', 'wan-3', 'seedance-2-5']) {
      const clamped = clampVideoToFamily(parsed, family === 'seedance-2-5' ? 'wan-3' : family)
      if (!Array.isArray(clamped.reference_audios)) throw new Error('audios not array')
      // also raw undefined args (production bug shape)
      clampVideoToFamily({ prompt: 'x', reference_images: parsed.reference_images, reference_videos: parsed.reference_videos }, family === 'seedance-2-5' ? 'wan-3' : family)
    }
    console.log('OK', name)
  } catch (e) {
    failed++
    console.error('FAIL', name, e.message)
  }
}

// Direct production-shaped args (parse omitted reference_audios)
try {
  const out = clampVideoToFamily({
    prompt: 'Woman walking',
    reference_images: ['https://x/a.jpg'],
    reference_videos: ['https://x/b.mp4'],
    // reference_audios intentionally undefined
    first_frame: '',
    duration: 5,
    resolution: '480p',
    aspect_ratio: '9:16',
  }, 'seedance-2')
  if (!Array.isArray(out.reference_audios) || out.reference_audios.length !== 0)
    throw new Error(`expected [] audios, got ${JSON.stringify(out.reference_audios)}`)
  console.log('OK production-shaped undefined reference_audios')
} catch (e) {
  failed++
  console.error('FAIL production-shaped', e.message)
}

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nAll checks passed')
