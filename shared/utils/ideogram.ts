export const IDEOGRAM_REMOVE_BACKGROUND_MODEL = 'fal-ai/ideogram/remove-background'
export const IDEOGRAM_REMOVE_BACKGROUND_MAX_BYTES = 10 * 1024 * 1024

export function isIdeogramRemoveBackgroundModel(model: string) {
  return model === IDEOGRAM_REMOVE_BACKGROUND_MODEL
}
