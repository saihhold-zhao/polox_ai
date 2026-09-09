import type { AgentQuality, ChoiceBody, ChoicePayload } from './types'

/** Only a matching model-preference card can change the generation preset. */
export function modelPreferenceFromChoice(payload: ChoicePayload, body: ChoiceBody): AgentQuality | undefined {
  const question = payload.questions.find(question => question.id === 'model_preference')
  if (!question)
    return
  const answer = body.answers?.find(answer => answer.questionId === question.id)
  const skipped = body.action === 'skip' || !answer || answer.skipped
  const optionId = skipped ? question.recommendedId : answer.optionId
  const option = question.options.find(option => option.id === optionId)
  if (!option)
    return
  if (option.custom)
    return !skipped && answer?.text?.trim() ? 'custom' : undefined
  if (option.id === 'high' || option.id === 'economy' || option.id === 'hobby' || option.id === 'custom')
    return option.id
}
