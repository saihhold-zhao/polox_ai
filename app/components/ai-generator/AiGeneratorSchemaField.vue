<script setup lang="ts">
import type { FieldConfig } from '@/types/aiModel'
import { Clock3, Monitor, Ratio } from 'lucide-vue-next'
import AspectRatioIcon from './AspectRatioIcon.vue'

const props = defineProps<{
  field: FieldConfig
  modelValue: unknown
  variant?: 'primary' | 'toolbar' | 'advanced'
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: unknown): void
}>()

const variant = computed(() => props.variant ?? 'advanced')

const stringValue = computed({
  get: () => String(props.modelValue ?? ''),
  set: value => emit('update:modelValue', value),
})

const numberValue = computed({
  get: () => Number(props.modelValue ?? 0),
  set: value => emit('update:modelValue', value),
})

const booleanValue = computed({
  get: () => Boolean(props.modelValue),
  set: value => emit('update:modelValue', value),
})

const enumOptions = computed(() =>
  (props.field.property.enum ?? []).map(option => ({
    label: props.field.key === 'duration' ? `${option}s` : String(option),
    value: String(option),
  })),
)

const isAspectRatioField = computed(() => props.field.key === 'aspect_ratio')

const toolbarIcon = computed(() => {
  if (props.field.key === 'aspect_ratio')
    return null
  if (props.field.key === 'duration')
    return Clock3
  if (props.field.key === 'resolution' || props.field.key === 'quality')
    return Ratio
  return Monitor
})
</script>

<template>
  <div
    v-if="field.widget === 'textarea' && variant === 'primary'"
    class="min-w-0 w-full flex-1"
  >
    <Textarea
      v-model="stringValue"
      :placeholder="field.property['x-placeholder'] || 'Describe your idea and watch it happen'"
      class="min-h-24 resize-none rounded-xl border-0 bg-muted/55 px-3 py-2.5 text-[0.925rem] shadow-none focus-visible:bg-muted/70 focus-visible:ring-1 focus-visible:ring-primary/45 md:min-h-24"
    />
  </div>

  <template v-else-if="field.widget === 'select' && variant === 'toolbar'">
    <Select
      :model-value="stringValue"
      @update:model-value="(value) => stringValue = value != null ? String(value) : ''"
    >
      <SelectTrigger
        size="sm"
        class="h-8 w-auto min-w-0 gap-1.5 border-border bg-muted/45 px-2.5 text-xs shadow-none dark:bg-muted/45 dark:hover:bg-accent [&_svg:not([class*=size-])]:size-3.5"
      >
        <AspectRatioIcon v-if="isAspectRatioField && stringValue" :ratio="stringValue" />
        <component :is="toolbarIcon" v-else-if="toolbarIcon" class="size-3.5 text-muted-foreground" />
        <SelectValue :placeholder="field.property['x-placeholder'] || field.label" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel class="w-full text-center font-bold text-foreground">
            {{ field.label }}
          </SelectLabel>
          <SelectSeparator />
          <SelectItem
            v-for="option in enumOptions"
            :key="option.value"
            :value="option.value"
          >
            <span class="flex items-center gap-2">
              <AspectRatioIcon v-if="isAspectRatioField" :ratio="option.value" />
              <span>{{ option.label }}</span>
            </span>
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </template>

  <template v-else-if="field.widget === 'select'">
    <div class="space-y-2">
      <Label class="text-sm">{{ field.label }}</Label>
      <Select
        :model-value="stringValue"
        @update:model-value="(value) => stringValue = value != null ? String(value) : ''"
      >
        <SelectTrigger>
          <span v-if="isAspectRatioField && stringValue" class="flex items-center gap-2">
            <AspectRatioIcon :ratio="stringValue" />
            <SelectValue :placeholder="field.property['x-placeholder'] || `Select ${field.label.toLowerCase()}`" />
          </span>
          <SelectValue v-else :placeholder="field.property['x-placeholder'] || `Select ${field.label.toLowerCase()}`" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel class="w-full text-center font-bold text-foreground">
              {{ field.label }}
            </SelectLabel>
            <SelectSeparator />
            <SelectItem
              v-for="option in enumOptions"
              :key="option.value"
              :value="option.value"
            >
              <span class="flex items-center gap-2">
                <AspectRatioIcon v-if="isAspectRatioField" :ratio="option.value" />
                <span>{{ option.label }}</span>
              </span>
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <p v-if="field.description" class="text-xs text-muted-foreground">
        {{ field.description }}
      </p>
    </div>
  </template>

  <template v-else-if="field.widget === 'radio'">
    <div class="space-y-2">
      <Label class="text-sm">{{ field.label }}</Label>
      <RadioGroup
        :model-value="stringValue"
        class="grid gap-2"
        @update:model-value="stringValue = $event"
      >
        <div
          v-for="option in enumOptions"
          :key="option.value"
          class="flex items-center gap-2"
        >
          <RadioGroupItem :id="`${field.key}-${option.value}`" :value="option.value" />
          <Label :for="`${field.key}-${option.value}`" class="font-normal">
            {{ option.label }}
          </Label>
        </div>
      </RadioGroup>
      <p v-if="field.description" class="text-xs text-muted-foreground">
        {{ field.description }}
      </p>
    </div>
  </template>

  <template v-else-if="field.widget === 'number'">
    <div class="space-y-2">
      <Label class="text-sm">{{ field.label }}</Label>
      <NumberField
        :model-value="numberValue"
        :min="field.property.minimum"
        :max="field.property.maximum"
        @update:model-value="numberValue = $event"
      >
        <NumberFieldContent>
          <NumberFieldDecrement />
          <NumberFieldInput />
          <NumberFieldIncrement />
        </NumberFieldContent>
      </NumberField>
      <p v-if="field.description" class="text-xs text-muted-foreground">
        {{ field.description }}
      </p>
    </div>
  </template>

  <template v-else-if="field.widget === 'switch'">
    <div class="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
      <div class="space-y-0.5">
        <Label class="text-sm">{{ field.label }}</Label>
        <p v-if="field.description" class="text-xs text-muted-foreground">
          {{ field.description }}
        </p>
      </div>
      <Switch
        :model-value="booleanValue"
        @update:model-value="booleanValue = $event"
      />
    </div>
  </template>

  <template v-else>
    <div class="space-y-2">
      <Label class="text-sm">{{ field.label }}</Label>
      <Input
        v-model="stringValue"
        :placeholder="field.property['x-placeholder'] || field.label"
      />
      <p v-if="field.description" class="text-xs text-muted-foreground">
        {{ field.description }}
      </p>
    </div>
  </template>
</template>
