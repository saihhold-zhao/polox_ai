import { isIdeogramRemoveBackgroundModel } from '~~/shared/utils/ideogram'
import { firstHttpUrl } from './mediaInput'

export function sanitizeIdeogramInput(model: string, input: Record<string, unknown>): Record<string, unknown> {
  if (!isIdeogramRemoveBackgroundModel(model)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unknown Ideogram model',
    })
  }

  return {
    image_url: firstHttpUrl(input.image_url, 'image_url', true),
  }
}
