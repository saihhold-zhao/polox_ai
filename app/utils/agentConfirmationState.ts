interface ConfirmationMessage {
  id: string
  confirmation?: { jobs?: Array<{ id: string }> }
  confirmationState?: 'pending' | 'confirmed' | 'cancelled' | 'blocked'
}

interface ConfirmationMedia {
  id: string
  kind?: string
  status: string
}

export function confirmationMedia(message: ConfirmationMessage, images: ConfirmationMedia[]) {
  const ids = new Set(message.confirmation?.jobs?.map(job => job.id) || [])
  return images.filter(image => image.kind !== 'upload' && [...ids].some(id => image.id === id || (image.id.startsWith(`${id}_`) && /^\d+$/.test(image.id.slice(id.length + 1)))))
}

/** A submitted job proves approval, even when an older snapshot lost the card state. */
export function reconcileConfirmationStates(messages: ConfirmationMessage[], images: ConfirmationMedia[]) {
  for (const message of messages) {
    if (message.confirmation && confirmationMedia(message, images).length)
      message.confirmationState = 'confirmed'
  }
}

export function confirmationWorking(message: ConfirmationMessage, images: ConfirmationMedia[], submitting: boolean) {
  if (message.confirmationState !== 'confirmed')
    return false
  const media = confirmationMedia(message, images)
  if (media.length)
    return media.some(image => image.status === 'generating')
  return submitting
}
