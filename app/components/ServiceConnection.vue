<script setup lang="ts">
import { AlertTriangle, CheckCircle2, LoaderCircle } from 'lucide-vue-next'
import { useServiceConnection } from '~/composables/useServiceConnection'

interface ConnectionStatus {
  connected: boolean
  openRouterConfigured: boolean
  falConfigured: boolean
  openRouterModel: string
  openRouterOk: boolean
  falOk: boolean
  checkedAt: string
}
const status = ref<ConnectionStatus | null>(null)
const { dialogOpen: open } = useServiceConnection()
const testing = ref(false)
const MASKED_KEY = '********'
const openRouterKey = ref('')
const openRouterModel = ref('')
const falKey = ref('')
function showSavedKeys() {
  openRouterKey.value = status.value?.openRouterConfigured ? MASKED_KEY : ''
  falKey.value = status.value?.falConfigured ? MASKED_KEY : ''
}
function selectKey(event: FocusEvent) {
  (event.target as HTMLInputElement).select()
}
const error = ref('')
const results = ref<{ openRouter: { ok: boolean, message: string }, fal: { ok: boolean, message: string } } | null>(null)
const connected = computed(() => Boolean(status.value?.connected))
async function refresh() {
  try { status.value = await $fetch<ConnectionStatus>('/api/settings/services') }
  catch { status.value = null }
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  refresh()
  timer = setInterval(refresh, 30000)
})
onUnmounted(() => clearInterval(timer))
watch(open, async (value) => {
  openRouterKey.value = ''
  falKey.value = ''
  if (!value)
    return
  await refresh()
  showSavedKeys()
  openRouterModel.value = status.value?.openRouterModel || 'deepseek/deepseek-v4-flash-vision-exp'
  results.value = null
  error.value = ''
})
async function testConnection() {
  testing.value = true
  results.value = null
  error.value = ''
  // A new test invalidates the previous green indicator immediately.
  if (status.value)
    status.value.connected = false
  try {
    const result = await $fetch<ConnectionStatus & NonNullable<typeof results.value> & { superseded: boolean }>('/api/settings/services', {
      method: 'POST',
      body: { openRouterKey: openRouterKey.value === MASKED_KEY ? undefined : openRouterKey.value, openRouterModel: openRouterModel.value, falKey: falKey.value === MASKED_KEY ? undefined : falKey.value },
      timeout: 65000,
    })
    status.value = result
    results.value = result
    if (result.superseded)
      error.value = 'Settings changed in another window. Test the current settings again.'
    showSavedKeys()
  }
  catch { error.value = 'Connection test could not finish. Please try again.'; await refresh() }
  finally { testing.value = false }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <button type="button" class="inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" :class="connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'" aria-label="Service connection" :title="connected ? 'OpenRouter and fal tested successfully' : 'Configure and test OpenRouter and fal'">
        <CheckCircle2 v-if="connected" class="size-4" />
        <AlertTriangle v-else class="size-4" />
        <span>{{ connected ? 'Services connected' : 'API keys not configured' }}</span>
      </button>
    </DialogTrigger>
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Service connection</DialogTitle>
        <DialogDescription>Connect OpenRouter and fal to start creating. Your keys are stored locally on this computer. Keep your API keys private. Never share them with anyone.</DialogDescription>
      </DialogHeader>
      <form class="space-y-4" @submit.prevent="testConnection">
        <div class="space-y-2">
          <div class="flex items-center gap-3">
            <Label for="openrouter-key">OpenRouter API key</Label>
            <a href="https://openrouter.ai/workspaces/default/keys" target="_blank" rel="noopener noreferrer" class="text-xs text-primary underline underline-offset-4 hover:opacity-80" aria-label="Get OpenRouter API key (opens in a new tab)">Get API key ↗</a>
          </div>
          <Input id="openrouter-key" v-model="openRouterKey" type="password" autocomplete="off" :disabled="testing" placeholder="Enter your OpenRouter API key" @focus="selectKey" />
        </div>
        <div class="space-y-2">
          <Label for="openrouter-model">OpenRouter model</Label>
          <Input id="openrouter-model" v-model="openRouterModel" required autocomplete="off" :disabled="testing" placeholder="provider/model-name" />
        </div>
        <div class="space-y-2">
          <div class="flex items-center gap-3">
            <Label for="fal-key">fal API key</Label>
            <a href="https://fal.ai/login?returnTo=%2Fdashboard%2Fkeys" target="_blank" rel="noopener noreferrer" class="text-xs text-primary underline underline-offset-4 hover:opacity-80" aria-label="Get fal API key (opens in a new tab)">Get API key ↗</a>
          </div>
          <Input id="fal-key" v-model="falKey" type="password" autocomplete="off" :disabled="testing" placeholder="Enter your fal API key" @focus="selectKey" />
        </div>
        <p class="text-xs text-muted-foreground">
          Clear a key to remove it when you test and save. Testing saves your settings, sends a short request to your OpenRouter model, and checks fal authentication and file upload. The model request may incur a small charge.
        </p>
        <div v-if="results" class="space-y-2 rounded-md border p-3 text-sm" role="status" aria-live="polite">
          <p :class="results.openRouter.ok ? 'text-emerald-600' : 'text-red-600'">
            {{ results.openRouter.ok ? '✓' : '⚠' }} {{ results.openRouter.message }}
          </p>
          <p :class="results.fal.ok ? 'text-emerald-600' : 'text-red-600'">
            {{ results.fal.ok ? '✓' : '⚠' }} {{ results.fal.message }}
          </p>
        </div>
        <p v-if="error" role="alert" class="text-sm text-red-600">
          {{ error }}
        </p>
        <DialogFooter>
          <Button type="submit" :disabled="testing || !openRouterModel.trim()">
            <LoaderCircle v-if="testing" class="mr-2 size-4 animate-spin" />
            {{ testing ? 'Testing connections…' : 'Test connection' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
