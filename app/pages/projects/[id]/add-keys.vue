<script setup lang="ts">
import type { PhraseLocale } from '~/composables/usePhrase'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const projectId = computed(() => route.params.id as string)

const {
  currentProject,
  locales,
  fetchProject,
  fetchLocales,
  checkKeysExist,
  bulkCreateKeys,
  bulkUpdateTranslations
} = usePhrase()

// JSON input
const jsonInput = ref('')
const parseError = ref<string | null>(null)

// Parsed data
interface ParsedKey {
  name: string
  translations: Record<string, string>
  status: 'new' | 'update' | 'unknown'
  existingTranslations?: Record<string, string>
}

const parsedKeys = ref<ParsedKey[]>([])
const detectedLocales = ref<string[]>([])
const isVerifying = ref(false)
const isImporting = ref(false)
const showPreview = ref(false)

// Options
const skipExisting = ref(false)

// Summary stats
const stats = computed(() => {
  const newKeys = parsedKeys.value.filter(k => k.status === 'new').length
  const updateKeys = parsedKeys.value.filter(k => k.status === 'update').length
  return { newKeys, updateKeys, total: parsedKeys.value.length }
})

// Keys to import based on options
const keysToImport = computed(() => {
  if (skipExisting.value) {
    return parsedKeys.value.filter(k => k.status === 'new')
  }
  return parsedKeys.value
})

// Load project data
onMounted(async () => {
  await Promise.all([
    fetchProject(projectId.value),
    fetchLocales(projectId.value)
  ])
})

// Detect JSON format and parse
function detectAndParseJson(input: string): { keys: ParsedKey[]; locales: string[] } | null {
  try {
    const data = JSON.parse(input)

    if (typeof data !== 'object' || data === null) {
      throw new Error('JSON must be an object')
    }

    const keys: ParsedKey[] = []
    const localesSet = new Set<string>()

    // Check first key to determine format
    const firstKey = Object.keys(data)[0]
    if (!firstKey) {
      throw new Error('JSON is empty')
    }

    const firstValue = data[firstKey]

    // Format 1: Nested by key { "key.name": { "en": "value", "fr": "value" } }
    if (typeof firstValue === 'object' && firstValue !== null && !Array.isArray(firstValue)) {
      // Check if first value looks like locale codes (2-5 chars, lowercase)
      const firstValueKeys = Object.keys(firstValue)
      const looksLikeLocales = firstValueKeys.every(k => /^[a-z]{2}(-[A-Z]{2})?$/.test(k))

      if (looksLikeLocales) {
        // Format 1: Keys with locale translations
        for (const [keyName, translations] of Object.entries(data)) {
          if (typeof translations === 'object' && translations !== null) {
            const trans = translations as Record<string, string>
            keys.push({
              name: keyName,
              translations: trans,
              status: 'unknown'
            })
            Object.keys(trans).forEach(locale => localesSet.add(locale))
          }
        }
      } else {
        // Format 2: Locales with key translations { "en": { "key.name": "value" } }
        const localeData = data as Record<string, Record<string, string>>
        const allKeys = new Set<string>()

        // Collect all keys from all locales
        for (const [locale, translations] of Object.entries(localeData)) {
          localesSet.add(locale)
          Object.keys(translations).forEach(k => allKeys.add(k))
        }

        // Build keys with translations
        for (const keyName of allKeys) {
          const translations: Record<string, string> = {}
          for (const [locale, localeTranslations] of Object.entries(localeData)) {
            if (localeTranslations[keyName]) {
              translations[locale] = localeTranslations[keyName]
            }
          }
          keys.push({
            name: keyName,
            translations,
            status: 'unknown'
          })
        }
      }
    } else {
      throw new Error('Unsupported JSON format. Expected object with key-locale or locale-key structure.')
    }

    return { keys, locales: Array.from(localesSet) }
  } catch (err) {
    if (err instanceof SyntaxError) {
      parseError.value = 'Invalid JSON syntax'
    } else if (err instanceof Error) {
      parseError.value = err.message
    }
    return null
  }
}

// Parse and verify the JSON
async function handleVerify() {
  parseError.value = null
  parsedKeys.value = []
  detectedLocales.value = []

  if (!jsonInput.value.trim()) {
    parseError.value = 'Please enter some JSON'
    return
  }

  const result = detectAndParseJson(jsonInput.value)
  if (!result) return

  parsedKeys.value = result.keys
  detectedLocales.value = result.locales

  if (parsedKeys.value.length === 0) {
    parseError.value = 'No keys found in JSON'
    return
  }

  // Check which keys already exist
  isVerifying.value = true
  try {
    const keyNames = parsedKeys.value.map(k => k.name)
    const existingKeys = await checkKeysExist(projectId.value, keyNames)

    // Update status based on existing keys
    for (const key of parsedKeys.value) {
      const existing = existingKeys.find(e => e.name === key.name)
      if (existing) {
        key.status = 'update'
        key.existingTranslations = existing.translations
      } else {
        key.status = 'new'
      }
    }

    showPreview.value = true
  } catch (err) {
    console.error('Failed to verify keys:', err)
    parseError.value = 'Failed to verify keys against Phrase'
  } finally {
    isVerifying.value = false
  }
}

// Import the keys
async function handleImport() {
  if (keysToImport.value.length === 0) {
    toast.add({
      title: 'Nothing to import',
      description: 'No keys selected for import',
      color: 'warning',
      icon: 'i-lucide-alert-triangle'
    })
    return
  }

  isImporting.value = true

  try {
    const newKeys = keysToImport.value.filter(k => k.status === 'new')
    const updateKeys = keysToImport.value.filter(k => k.status === 'update')

    let createdCount = 0
    let updatedCount = 0
    let errorCount = 0

    // Create new keys
    if (newKeys.length > 0) {
      const result = await bulkCreateKeys(projectId.value, newKeys.map(k => ({
        name: k.name,
        translations: k.translations
      })))
      createdCount = result.created
      errorCount += result.errors
    }

    // Update existing keys
    if (updateKeys.length > 0) {
      const result = await bulkUpdateTranslations(projectId.value, updateKeys.map(k => ({
        keyName: k.name,
        translations: k.translations
      })))
      updatedCount = result.updated
      errorCount += result.errors
    }

    // Show result
    if (errorCount > 0) {
      toast.add({
        title: 'Import completed with errors',
        description: `Created: ${createdCount}, Updated: ${updatedCount}, Errors: ${errorCount}`,
        color: 'warning',
        icon: 'i-lucide-alert-triangle'
      })
    } else {
      toast.add({
        title: 'Import successful',
        description: `Created: ${createdCount}, Updated: ${updatedCount}`,
        color: 'success',
        icon: 'i-lucide-check-circle'
      })
    }

    // Go back to project page
    router.push(`/projects/${projectId.value}`)
  } catch (err) {
    console.error('Import failed:', err)
    toast.add({
      title: 'Import failed',
      description: 'An error occurred while importing keys',
      color: 'error',
      icon: 'i-lucide-x-circle'
    })
  } finally {
    isImporting.value = false
  }
}

// Reset to edit mode
function handleEdit() {
  showPreview.value = false
}

// Go back
function goBack() {
  router.push(`/projects/${projectId.value}`)
}

// Get locale name from code
function getLocaleName(code: string): string {
  const locale = locales.value.find(l => l.code === code)
  return locale?.name || code
}
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-8">
    <!-- Header -->
    <div class="flex items-center gap-4 mb-8">
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        @click="goBack"
      />
      <div>
        <h1 class="text-2xl font-bold text-highlighted">
          Add Keys
        </h1>
        <p class="text-sm text-muted">
          {{ currentProject?.name || 'Loading...' }}
        </p>
      </div>
    </div>

    <!-- JSON Input Section (shown when not in preview) -->
    <UCard v-if="!showPreview" class="mb-6">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-code" class="size-5 text-primary" />
          <h2 class="font-semibold text-highlighted">
            Paste JSON
          </h2>
        </div>
      </template>

      <div class="space-y-4">
        <p class="text-sm text-muted">
          Paste your translation JSON below. Supported formats:
        </p>

        <div class="grid md:grid-cols-2 gap-4 text-xs">
          <div class="p-3 bg-elevated/50 rounded-lg">
            <p class="font-medium text-highlighted mb-2">Format 1: By Key</p>
            <pre class="text-muted overflow-x-auto">{
  "key.name": {
    "en": "English",
    "fr": "French"
  }
}</pre>
          </div>
          <div class="p-3 bg-elevated/50 rounded-lg">
            <p class="font-medium text-highlighted mb-2">Format 2: By Locale</p>
            <pre class="text-muted overflow-x-auto">{
  "en": {
    "key.name": "English"
  },
  "fr": {
    "key.name": "French"
  }
}</pre>
          </div>
        </div>

        <UTextarea
          v-model="jsonInput"
          :rows="15"
          placeholder="Paste your JSON here..."
          class="font-mono text-sm"
          :color="parseError ? 'error' : undefined"
        />

        <UAlert
          v-if="parseError"
          color="error"
          icon="i-lucide-alert-circle"
          :title="parseError"
        />

        <div class="flex justify-end">
          <UButton
            icon="i-lucide-check-circle"
            :loading="isVerifying"
            :disabled="!jsonInput.trim()"
            @click="handleVerify"
          >
            Verify & Preview
          </UButton>
        </div>
      </div>
    </UCard>

    <!-- Preview Section (shown after verification) -->
    <template v-if="showPreview">
      <!-- Summary Card -->
      <UCard class="mb-6">
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-clipboard-list" class="size-5 text-primary" />
              <h2 class="font-semibold text-highlighted">
                Import Preview
              </h2>
            </div>
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-pencil"
              @click="handleEdit"
            >
              Edit JSON
            </UButton>
          </div>
        </template>

        <div class="space-y-4">
          <!-- Stats -->
          <div class="grid grid-cols-3 gap-4">
            <div class="text-center p-4 bg-elevated/50 rounded-lg">
              <p class="text-2xl font-bold text-highlighted">{{ stats.total }}</p>
              <p class="text-sm text-muted">Total Keys</p>
            </div>
            <div class="text-center p-4 bg-success/10 rounded-lg">
              <p class="text-2xl font-bold text-success">{{ stats.newKeys }}</p>
              <p class="text-sm text-muted">New Keys</p>
            </div>
            <div class="text-center p-4 bg-warning/10 rounded-lg">
              <p class="text-2xl font-bold text-warning">{{ stats.updateKeys }}</p>
              <p class="text-sm text-muted">Updates</p>
            </div>
          </div>

          <!-- Detected Locales -->
          <div>
            <p class="text-sm text-muted mb-2">Detected languages:</p>
            <div class="flex flex-wrap gap-2">
              <UBadge
                v-for="locale in detectedLocales"
                :key="locale"
                color="primary"
                variant="subtle"
              >
                {{ getLocaleName(locale) }} ({{ locale }})
              </UBadge>
            </div>
          </div>

          <!-- Warning for updates -->
          <UAlert
            v-if="stats.updateKeys > 0"
            color="warning"
            icon="i-lucide-alert-triangle"
            title="Existing keys will be updated"
            :description="`${stats.updateKeys} key(s) already exist and will have their translations overwritten.`"
          />

          <!-- Skip existing option -->
          <UCheckbox
            v-if="stats.updateKeys > 0"
            v-model="skipExisting"
            label="Skip existing keys (only add new keys)"
          />
        </div>
      </UCard>

      <!-- Preview Table -->
      <UCard class="mb-6">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-table" class="size-5 text-primary" />
            <h2 class="font-semibold text-highlighted">
              Keys to Import
              <UBadge color="neutral" variant="subtle" class="ml-2">
                {{ keysToImport.length }}
              </UBadge>
            </h2>
          </div>
        </template>

        <div class="overflow-x-auto max-h-96">
          <table class="min-w-full divide-y divide-default">
            <thead class="bg-elevated/50 sticky top-0">
              <tr>
                <th class="px-4 py-3 text-left text-sm font-semibold text-highlighted">
                  Status
                </th>
                <th class="px-4 py-3 text-left text-sm font-semibold text-highlighted">
                  Key
                </th>
                <th
                  v-for="locale in detectedLocales"
                  :key="locale"
                  class="px-4 py-3 text-left text-sm font-semibold text-highlighted min-w-[200px]"
                >
                  {{ getLocaleName(locale) }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-default">
              <tr
                v-for="key in keysToImport"
                :key="key.name"
                :class="{
                  'bg-success/5': key.status === 'new',
                  'bg-warning/5': key.status === 'update'
                }"
              >
                <td class="px-4 py-3">
                  <UBadge
                    :color="key.status === 'new' ? 'success' : 'warning'"
                    variant="subtle"
                    class="capitalize"
                  >
                    {{ key.status }}
                  </UBadge>
                </td>
                <td class="px-4 py-3 font-mono text-sm">
                  {{ key.name }}
                </td>
                <td
                  v-for="locale in detectedLocales"
                  :key="`${key.name}-${locale}`"
                  class="px-4 py-3 text-sm"
                >
                  <div v-if="key.translations[locale]">
                    {{ key.translations[locale] }}
                  </div>
                  <span v-else class="text-muted italic">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>

      <!-- Actions -->
      <div class="flex items-center justify-between">
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-x"
          @click="goBack"
        >
          Cancel
        </UButton>

        <UButton
          icon="i-lucide-upload"
          :loading="isImporting"
          :disabled="keysToImport.length === 0"
          @click="handleImport"
        >
          Import {{ keysToImport.length }} Key{{ keysToImport.length === 1 ? '' : 's' }}
        </UButton>
      </div>
    </template>
  </div>
</template>

