<script setup lang="ts">
import type { ImageLayerRegion } from '~~/shared/utils/imageLayerSplitter'
import type { ChoiceAnswer, ChoicePayload, ChoiceQuestion } from '~/composables/useAgentLab'
import { withCustomChoiceOption } from '~~/shared/utils/agentChoices'

const props = withDefaults(defineProps<{
  choice: ChoicePayload
  state?: 'pending' | 'answered' | 'skipped'
  answers?: ChoiceAnswer[]
  pending?: boolean
  sourceImages?: { id: string, url: string }[]
}>(), {
  pending: false,
})

const emit = defineEmits<{
  submit: [answers: ChoiceAnswer[]]
  skip: []
}>()

const questions = computed(() => props.choice.questions.map(question => ({
  ...question,
  options: withCustomChoiceOption(question.options),
})))

const isPending = computed(() => (props.state || 'pending') === 'pending')
const selections = ref<Record<string, { optionId: string, text: string }>>({})
const regionsByImage = ref<Record<string, ImageLayerRegion[]>>({})
const sourceUrl = ref('')
const regions = computed({
  get: () => regionsByImage.value[sourceUrl.value] || [],
  set: (value: ImageLayerRegion[]) => { regionsByImage.value[sourceUrl.value] = value },
})
const imageSelections = computed(() => (props.sourceImages || []).map(image => ({
  imageUrl: image.url,
  regions: (regionsByImage.value[image.url] || []).map(box => [...box] as ImageLayerRegion),
})))
const selecting = ref(false)
const drawing = computed(() => selections.value.layer_selection_method?.optionId === 'draw_boxes')
watch(() => props.sourceImages, (images) => {
  if (!images?.some(image => image.url === sourceUrl.value))
    sourceUrl.value = images?.[0]?.url || ''
}, { immediate: true })
watch(sourceUrl, () => { selecting.value = false }, { flush: 'sync' })

watch(
  () => props.choice.id,
  () => {
    selections.value = {}
    regionsByImage.value = {}
    for (const answer of props.answers || []) {
      if (answer.optionId)
        selections.value[answer.questionId] = { optionId: answer.optionId, text: answer.text || '' }
      if (answer.questionId === 'layer_selection_method' && answer.optionId === 'draw_boxes') {
        for (const selection of answer.imageSelections || (answer.imageUrl ? [{ imageUrl: answer.imageUrl, regions: answer.regions || [] }] : [])) {
          if (props.sourceImages?.some(image => image.url === selection.imageUrl))
            regionsByImage.value[selection.imageUrl] = selection.regions.map(box => [...box] as ImageLayerRegion)
        }
      }
    }
  },
  { immediate: true },
)

function selectedOption(question: ChoiceQuestion) {
  const current = selections.value[question.id]
  if (!current)
    return null
  return question.options.find(item => item.id === current.optionId) || null
}

function selectOption(question: ChoiceQuestion, optionId: string) {
  if (!isPending.value || props.pending)
    return
  const option = question.options.find(item => item.id === optionId)
  if (!option)
    return
  const previous = selections.value[question.id]
  selections.value = {
    ...selections.value,
    [question.id]: {
      optionId,
      text: option.custom ? (previous?.optionId === optionId ? previous.text : '') : '',
    },
  }
}

function setCustomText(questionId: string, value: string) {
  const current = selections.value[questionId]
  if (!current)
    return
  selections.value = {
    ...selections.value,
    [questionId]: {
      ...current,
      text: value,
    },
  }
}

const canSubmit = computed(() => {
  if (!isPending.value || props.pending)
    return false
  if (drawing.value && (!imageSelections.value.length || imageSelections.value.some(selection => !selection.regions.length) || selecting.value))
    return false
  return questions.value.every((question) => {
    const option = selectedOption(question)
    if (!option)
      return false
    if (option.custom)
      return Boolean(selections.value[question.id]?.text.trim())
    return true
  })
})

function emitSubmit() {
  if (!canSubmit.value)
    return
  emit('submit', questions.value.map((question) => {
    const current = selections.value[question.id]
    const option = selectedOption(question)
    return {
      questionId: question.id,
      optionId: current?.optionId,
      label: option?.label,
      text: current?.text.trim() || undefined,
      ...(question.id === 'layer_selection_method' && current?.optionId === 'draw_boxes'
        ? { imageSelections: imageSelections.value }
        : {}),
    }
  }))
}

function optionLabel(question: ChoiceQuestion, answer?: ChoiceAnswer) {
  if (!answer || answer.skipped)
    return ''
  if (answer.text && answer.label)
    return `${answer.label}: ${answer.text}`
  if (answer.text)
    return answer.text
  if (answer.label)
    return answer.label
  const option = question.options.find(item => item.id === answer.optionId)
  return option?.label || answer.optionId || ''
}

const resolvedAnswers = computed(() => {
  const byId = new Map((props.answers || []).map(item => [item.questionId, item]))
  return questions.value.map((question) => {
    const answer = byId.get(question.id)
    return {
      question,
      answer,
      skipped: Boolean(answer?.skipped || props.state === 'skipped'),
      summary: optionLabel(question, answer),
    }
  })
})
</script>

<template>
  <AgentLabTextEditor v-if="choice.textEdit || choice.textEdits" :key="choice.id" :edit="choice.textEdit" :edits="choice.textEdits" :pending="pending" :state="state" :answers="answers" @submit="emit('submit', $event)" @skip="emit('skip')" />
  <Card
    v-else
    class="relative w-full gap-4 rounded-2xl border-blue-500/70 py-4 shadow-none"
  >
    <AgentLabCardBorder v-if="isPending" tone="attention" />
    <CardHeader class="gap-1.5 px-4">
      <div class="flex items-center justify-between gap-2">
        <CardTitle class="text-sm font-medium">
          {{ choice.prompt || 'A few choices' }}
        </CardTitle>
        <Badge
          v-if="state === 'skipped'"
          variant="outline"
        >
          Agent will decide
        </Badge>
        <Badge
          v-else-if="state === 'answered'"
          variant="outline"
        >
          Saved
        </Badge>
      </div>
      <CardDescription v-if="isPending && choice.recommendation">
        {{ choice.recommendation }}
      </CardDescription>
      <p
        v-else-if="isPending"
        class="text-xs text-muted-foreground"
      >
        Skip any time to let the agent decide.
      </p>
    </CardHeader>

    <CardContent v-if="isPending" class="px-4">
      <div class="flex flex-col gap-5">
        <fieldset
          v-for="question in questions"
          :key="question.id"
          class="min-w-0"
        >
          <legend class="mb-2 flex min-w-0 flex-col gap-0.5">
            <span
              v-if="question.title"
              class="text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
            >
              {{ question.title }}
            </span>
            <span class="text-sm font-medium text-foreground">
              {{ question.prompt }}
            </span>
          </legend>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              v-for="option in question.options"
              :key="option.id"
              type="button"
              class="flex min-h-16 flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              :class="selectedOption(question)?.id === option.id
                ? 'border-primary bg-primary/10'
                : 'border-border bg-muted/35 hover:bg-accent'"
              :disabled="pending"
              :aria-pressed="selectedOption(question)?.id === option.id"
              @click="selectOption(question, option.id)"
            >
              <span class="flex w-full items-start justify-between gap-2">
                <span class="text-sm font-medium text-foreground">
                  {{ option.label }}
                </span>
                <Badge
                  v-if="question.recommendedId === option.id"
                  variant="outline"
                  class="shrink-0 border-primary/40 text-[10px] text-primary"
                >
                  Suggested
                </Badge>
              </span>
              <span
                v-if="option.description"
                class="text-xs leading-5 text-muted-foreground"
              >
                {{ option.description }}
              </span>
            </button>
          </div>
          <Input
            v-if="selectedOption(question)?.custom"
            :id="`agent-choice-${choice.id}-${question.id}`"
            :model-value="selections[question.id]?.text || ''"
            :disabled="pending"
            class="mt-2 h-10 rounded-xl bg-input/30 shadow-none"
            placeholder="Type your own"
            :aria-label="`Custom answer: ${question.prompt}`"
            @update:model-value="setCustomText(question.id, String($event))"
            @keydown.enter.prevent="emitSubmit()"
          />
        </fieldset>
        <section v-if="drawing" class="flex min-w-0 flex-col gap-3" aria-label="Select image layers">
          <p class="text-sm text-muted-foreground">
            Draw boxes on each image, then confirm all images together. Your boxes are saved when switching images.
          </p>
          <div v-if="(sourceImages?.length || 0) > 1" class="flex flex-wrap gap-2" aria-label="Source image">
            <button v-for="image in sourceImages" :key="image.id" type="button" class="rounded-lg border p-1" :class="sourceUrl === image.url ? 'border-primary' : 'border-border'" :aria-pressed="sourceUrl === image.url" :disabled="pending || selecting" @click="sourceUrl = image.url">
              <img :src="image.url" alt="Select source image" class="size-16 object-contain">
              <span class="block text-xs">{{ regionsByImage[image.url]?.length || 0 }} regions</span>
            </button>
          </div>
          <ToolsImageRegionSelector v-if="sourceUrl" :key="sourceUrl" v-model="regions" :src="sourceUrl" :disabled="pending" @selecting="selecting = $event" />
          <p v-else role="status" class="text-sm text-muted-foreground">
            No source image is available. Upload an image in the chat first.
          </p>
        </section>
      </div>
    </CardContent>

    <CardContent v-else class="px-4">
      <div class="flex flex-col gap-3">
        <div
          v-for="item in resolvedAnswers"
          :key="item.question.id"
          class="min-w-0"
        >
          <p class="text-xs text-muted-foreground">
            {{ item.question.title || item.question.prompt }}
          </p>
          <p class="mt-0.5 text-sm text-foreground">
            {{ item.skipped ? 'Agent will decide' : (item.summary || 'Saved') }}
          </p>
          <p v-if="item.answer?.imageSelections?.length" class="mt-1 text-xs text-muted-foreground">
            {{ item.answer.imageSelections.length }} images · {{ item.answer.imageSelections.reduce((total, selection) => total + selection.regions.length, 0) }} regions confirmed
          </p>
          <p v-else-if="item.answer?.regions?.length" class="mt-1 text-xs text-muted-foreground">
            {{ item.answer.regions.length }} regions confirmed
          </p>
        </div>
      </div>
    </CardContent>

    <CardFooter v-if="isPending" class="justify-end gap-2 border-t border-border px-4 pt-3">
      <Button
        variant="outline"
        size="sm"
        class="rounded-lg shadow-none"
        :disabled="pending"
        @click="emit('skip')"
      >
        Skip
      </Button>
      <Button
        size="sm"
        class="rounded-lg shadow-none"
        :disabled="!canSubmit"
        @click="emitSubmit"
      >
        <Spinner v-if="pending" />
        {{ drawing ? `Confirm ${imageSelections.length} image${imageSelections.length === 1 ? '' : 's'}` : 'Continue' }}
      </Button>
    </CardFooter>
  </Card>
</template>
