<script setup lang="ts">
import JsonEditorVue from 'json-editor-vue'
import 'vanilla-jsoneditor/themes/jse-theme-dark.css'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const colorMode = useColorMode()

const projectId = computed(() => route.params.id as string)
const isDarkMode = computed(() => colorMode.value === 'dark')

const {
  currentProject,
  locales,
  findLocale,
  fetchProject,
  fetchLocales,
  checkKeysExist,
  bulkCreateKeys,
  bulkUpdateTranslations
} = usePhrase()

// JSON input - using object for json-editor-vue
const jsonInput = ref<Record<string, Record<string, string>>>({})
const parseError = ref<string | null>(null)

// LocalStorage key for persisting editor content
const storageKey = computed(() => `better-phrase-editor-${projectId.value}`)
const requireAllStorageKey = computed(() => `better-phrase-require-all-${projectId.value}`)

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
const skipUnchanged = ref(false)
const requireAllLocales = ref(false)
const activeTab = ref<'editor' | 'preview'>('editor')

// Import errors
const importErrors = ref<string[]>([])

// Check if a key has any actual changes in translations
function hasChanges(key: ParsedKey): boolean {
  if (key.status === 'new') return true
  if (!key.existingTranslations) return true

  for (const [locale, value] of Object.entries(key.translations)) {
    if (key.existingTranslations[locale] !== value) {
      return true
    }
  }
  return false
}

// Summary stats
const stats = computed(() => {
  const newKeys = parsedKeys.value.filter(k => k.status === 'new').length
  const updateKeys = parsedKeys.value.filter(k => k.status === 'update').length
  const unchangedKeys = parsedKeys.value.filter(k => k.status === 'update' && !hasChanges(k)).length
  return { newKeys, updateKeys, unchangedKeys, total: parsedKeys.value.length }
})

// Keys to import based on options
const keysToImport = computed(() => {
  let keys = parsedKeys.value

  if (skipExisting.value) {
    keys = keys.filter(k => k.status === 'new')
  }

  if (skipUnchanged.value) {
    keys = keys.filter(k => hasChanges(k))
  }

  return keys
})

// Pasted locales that don't exist in the project: their translations can't be imported
const unknownLocales = computed(() =>
  detectedLocales.value.filter(code => !locales.value.some(l => l.code === code))
)

// Project locales a key will still lack after import, counting translations already in Phrase
function missingLocales(key: ParsedKey): string[] {
  return locales.value
    .filter(l => !key.translations[l.code] && !key.existingTranslations?.[l.code])
    .map(l => l.code)
    .sort()
}

const keysMissingLocales = computed(() =>
  keysToImport.value.filter(k => missingLocales(k).length > 0).length
)

const importBlocked = computed(() =>
  keysToImport.value.length === 0
  || unknownLocales.value.length > 0
  || (requireAllLocales.value && keysMissingLocales.value > 0)
)

// Load project data only if not already loaded
onMounted(async () => {
  const promises: Promise<unknown>[] = []

  // Only fetch if not already loaded
  if (!currentProject.value || currentProject.value.id !== projectId.value) {
    promises.push(fetchProject(projectId.value))
  }
  if (locales.value.length === 0) {
    promises.push(fetchLocales(projectId.value))
  }

  if (promises.length > 0) {
    await Promise.all(promises)
  }

  requireAllLocales.value = localStorage.getItem(requireAllStorageKey.value) === 'true'

  // Restore editor content from localStorage
  const saved = localStorage.getItem(storageKey.value)
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        jsonInput.value = parsed
      }
    } catch {
      // Invalid JSON in storage, ignore
    }
  }
})

// Save editor content to localStorage when it changes
watch(jsonInput, (newValue) => {
  if (newValue && Object.keys(newValue).length > 0) {
    localStorage.setItem(storageKey.value, JSON.stringify(newValue))
  }
}, { deep: true })

watch(requireAllLocales, (value) => {
  localStorage.setItem(requireAllStorageKey.value, String(value))
})

// Parse JSON object in format: { "key.name": { "en": "value", "fr": "value" } }
function parseJsonData(data: Record<string, Record<string, string>>): { keys: ParsedKey[], locales: string[] } | null {
  try {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error('JSON must be an object')
    }

    const keys: ParsedKey[] = []
    const localesSet = new Set<string>()

    if (Object.keys(data).length === 0) {
      throw new Error('JSON is empty')
    }

    // Parse format: { "key.name": { "en": "value", "fr": "value" } }
    for (const [keyName, translations] of Object.entries(data)) {
      if (typeof translations !== 'object' || translations === null || Array.isArray(translations)) {
        throw new Error(`Invalid value for key "${keyName}". Expected an object with locale translations.`)
      }

      // Accept locale names as well as codes, and work with codes from here on.
      // Empty values (e.g. from a copied template) mean "not provided" rather than "clear".
      const trans: Record<string, string> = {}
      for (const [locale, value] of Object.entries(translations as Record<string, string>)) {
        if (value === '') continue
        trans[findLocale(locale)?.code ?? locale] = value
      }
      keys.push({
        name: keyName,
        translations: trans,
        status: 'unknown'
      })
      Object.keys(trans).forEach(locale => localesSet.add(locale))
    }

    return { keys, locales: Array.from(localesSet) }
  } catch (err) {
    if (err instanceof Error) {
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
  importErrors.value = []

  if (!jsonInput.value || Object.keys(jsonInput.value).length === 0) {
    parseError.value = 'Please enter some JSON'
    return
  }

  const result = parseJsonData(jsonInput.value)
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
    activeTab.value = 'preview'
  } catch (err) {
    console.error('Failed to verify keys:', err)
    parseError.value = 'Failed to verify keys against Phrase'
  } finally {
    isVerifying.value = false
  }
}

// Import the keys
async function handleImport() {
  if (importBlocked.value) return
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
  importErrors.value = []

  try {
    const newKeys = keysToImport.value.filter(k => k.status === 'new')
    const updateKeys = keysToImport.value.filter(k => k.status === 'update')

    let createdCount = 0
    let updatedCount = 0
    let errorCount = 0
    const allErrorDetails: string[] = []

    // Create new keys
    if (newKeys.length > 0) {
      const result = await bulkCreateKeys(projectId.value, newKeys.map(k => ({
        name: k.name,
        translations: k.translations
      })))
      createdCount = result.created
      errorCount += result.errors
      allErrorDetails.push(...result.errorDetails)
    }

    // Update existing keys
    if (updateKeys.length > 0) {
      const result = await bulkUpdateTranslations(projectId.value, updateKeys.map(k => ({
        keyName: k.name,
        translations: k.translations
      })))
      updatedCount = result.updated
      errorCount += result.errors
      allErrorDetails.push(...result.errorDetails)
    }

    // Show result
    if (errorCount > 0 || allErrorDetails.length > 0) {
      importErrors.value = allErrorDetails
      toast.add({
        title: 'Import completed with errors',
        description: `Created: ${createdCount}, Updated: ${updatedCount}, Errors: ${allErrorDetails.length}`,
        color: 'warning',
        icon: 'i-lucide-alert-triangle'
      })
      // Stay on page so user can review and retry
    } else {
      toast.add({
        title: 'Import successful',
        description: `Created: ${createdCount}, Updated: ${updatedCount}`,
        color: 'success',
        icon: 'i-lucide-check-circle'
      })

      // Clear saved editor content on successful import
      localStorage.removeItem(storageKey.value)

      // Go back to project page only on full success
      router.push(`/projects/${projectId.value}`)
    }
  } catch (err) {
    console.error('Import failed:', err)
    const errorMsg = err instanceof Error ? err.message : 'An error occurred while importing keys'
    importErrors.value = [errorMsg]
    toast.add({
      title: 'Import failed',
      description: errorMsg,
      color: 'error',
      icon: 'i-lucide-x-circle'
    })
  } finally {
    isImporting.value = false
  }
}

// Go back
function goBack() {
  router.push(`/projects/${projectId.value}`)
}

// Clear editor content
function clearEditor() {
  jsonInput.value = {}
  parsedKeys.value = []
  detectedLocales.value = []
  showPreview.value = false
  activeTab.value = 'editor'
  importErrors.value = []
  localStorage.removeItem(storageKey.value)
}

// Get locale name from code
function getLocaleName(code: string): string {
  const locale = locales.value.find(l => l.code === code)
  return locale?.name || code
}

// Word-level diff for better change visualization
interface DiffPart {
  type: 'same' | 'added' | 'removed'
  text: string
}

function computeWordDiff(oldText: string, newText: string): DiffPart[] {
  // Split by words while preserving whitespace
  const oldWords = oldText.split(/(\s+)/).filter(Boolean)
  const newWords = newText.split(/(\s+)/).filter(Boolean)

  // Simple LCS-based diff
  const lcs = longestCommonSubsequence(oldWords, newWords)
  const result: DiffPart[] = []

  let oldIdx = 0
  let newIdx = 0
  let lcsIdx = 0

  while (oldIdx < oldWords.length || newIdx < newWords.length) {
    const lcsWord = lcsIdx < lcs.length ? lcs[lcsIdx] : null
    const oldWord = oldIdx < oldWords.length ? oldWords[oldIdx] : null
    const newWord = newIdx < newWords.length ? newWords[newIdx] : null

    if (lcsWord !== null && oldWord === lcsWord && newWord === lcsWord) {
      // Common word
      result.push({ type: 'same', text: lcsWord as string })
      oldIdx++
      newIdx++
      lcsIdx++
    } else if (oldWord !== null && (lcsWord === null || oldWord !== lcsWord)) {
      // Removed word
      result.push({ type: 'removed', text: oldWord as string })
      oldIdx++
    } else if (newWord !== null && (lcsWord === null || newWord !== lcsWord)) {
      // Added word
      result.push({ type: 'added', text: newWord as string })
      newIdx++
    }
  }

  return mergeDiffParts(result)
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length
  const n = b.length

  // Create DP table
  const dp: number[][] = []
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array(n + 1).fill(0)
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = (dp[i - 1]?.[j - 1] ?? 0) + 1
      } else {
        dp[i]![j] = Math.max(dp[i - 1]?.[j] ?? 0, dp[i]?.[j - 1] ?? 0)
      }
    }
  }

  // Backtrack to find LCS
  const lcs: string[] = []
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]!)
      i--
      j--
    } else if ((dp[i - 1]?.[j] ?? 0) > (dp[i]?.[j - 1] ?? 0)) {
      i--
    } else {
      j--
    }
  }

  return lcs
}

function mergeDiffParts(parts: DiffPart[]): DiffPart[] {
  if (parts.length === 0) return parts

  const merged: DiffPart[] = []
  const first = parts[0]!
  let current: DiffPart = { type: first.type, text: first.text }

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!
    if (part.type === current.type) {
      current.text += part.text
    } else {
      merged.push(current)
      current = { type: part.type, text: part.text }
    }
  }
  merged.push(current)

  return merged
}
</script>

<template>
  <div class="px-4 py-2 h-full flex flex-col">
    <!-- Combined Header -->
    <div class="shrink-0 mb-2 flex items-center justify-between gap-4 border-b border-default pb-2">
      <!-- Left: Logo + Back + Title + Tabs -->
      <div class="flex items-center gap-3">
        <NuxtLink
          to="/"
          class="flex items-center gap-2 shrink-0"
        >
          <AppLogo class="w-auto h-6" />
        </NuxtLink>
        <span class="text-muted/30">|</span>
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          size="xs"
          @click="goBack"
        />
        <div class="flex items-center gap-2">
          <h1 class="text-sm font-semibold text-highlighted">
            Add Keys
          </h1>
          <span class="text-xs text-muted">{{ currentProject?.name }}</span>
        </div>
        <span class="text-muted/30">|</span>
        <!-- Tabs -->
        <div class="flex items-center gap-0.5 bg-elevated/50 p-0.5 rounded-md">
          <button
            class="px-3 py-1 text-xs font-medium rounded transition-colors"
            :class="activeTab === 'editor' ? 'bg-default text-highlighted shadow-sm' : 'text-muted hover:text-highlighted'"
            @click="activeTab = 'editor'"
          >
            Editor
          </button>
          <UTooltip
            :text="!showPreview ? 'Verify JSON first' : undefined"
            :disabled="showPreview"
          >
            <button
              class="px-3 py-1 text-xs font-medium rounded transition-colors flex items-center gap-1"
              :class="[
                activeTab === 'preview' ? 'bg-default text-highlighted shadow-sm' : 'text-muted hover:text-highlighted',
                !showPreview && 'opacity-50 cursor-not-allowed'
              ]"
              :disabled="!showPreview"
              @click="showPreview && (activeTab = 'preview')"
            >
              Preview
              <UBadge
                v-if="showPreview"
                :color="stats.updateKeys > 0 ? 'warning' : 'success'"
                variant="subtle"
                size="xs"
              >
                {{ keysToImport.length }}
              </UBadge>
            </button>
          </UTooltip>
        </div>
      </div>

      <!-- Right: Actions + App Controls -->
      <div class="flex items-center gap-2">
        <UAlert
          v-if="parseError"
          color="error"
          variant="subtle"
          class="py-0.5 px-2"
        >
          <span class="text-xs">{{ parseError }}</span>
        </UAlert>

        <UPopover
          mode="hover"
          :content="{ side: 'bottom', align: 'end' }"
        >
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-help-circle"
          />
          <template #content>
            <div class="p-3 text-xs max-w-xs">
              <p class="font-medium text-highlighted mb-2">
                Expected format (locale codes or names):
              </p>
              <pre class="text-muted bg-elevated/50 p-2 rounded overflow-x-auto">{
  "key.name": {
    "en": "English value",
    "fr": "French value"
  }
}</pre>
            </div>
          </template>
        </UPopover>

        <UButton
          v-if="activeTab === 'editor' && jsonInput && Object.keys(jsonInput).length > 0"
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="clearEditor"
        >
          Clear
        </UButton>

        <UButton
          v-if="activeTab === 'editor'"
          icon="i-lucide-check-circle"
          size="xs"
          :loading="isVerifying"
          :disabled="!jsonInput || Object.keys(jsonInput).length === 0"
          @click="handleVerify"
        >
          Verify
        </UButton>

        <template v-if="activeTab === 'preview' && showPreview">
          <UCheckbox
            v-if="stats.updateKeys > 0"
            v-model="skipExisting"
            label="Skip existing"
            size="xs"
          />
          <UCheckbox
            v-if="stats.unchangedKeys > 0"
            v-model="skipUnchanged"
            label="Skip unchanged"
            size="xs"
          />
          <UCheckbox
            v-model="requireAllLocales"
            label="Require every language"
            size="xs"
          />
          <UButton
            icon="i-lucide-upload"
            size="xs"
            :loading="isImporting"
            :disabled="importBlocked"
            @click="handleImport"
          >
            Import {{ keysToImport.length }}
          </UButton>
        </template>

        <span class="text-muted/30">|</span>
        <LanguageSelector />
        <UColorModeButton size="xs" />
        <UButton
          to="https://github.com/MrSunshyne/better-phrase"
          target="_blank"
          icon="i-simple-icons-github"
          aria-label="GitHub"
          color="neutral"
          variant="ghost"
          size="xs"
        />
      </div>
    </div>

    <!-- Editor Tab -->
    <div
      v-show="activeTab === 'editor'"
      class="flex-1 min-h-0 border border-default rounded-lg overflow-auto"
    >
      <ClientOnly>
        <JsonEditorVue
          v-model="jsonInput"
          mode="text"
          :stringified="false"
          :main-menu-bar="false"
          :navigation-bar="false"
          :class="['json-editor-container', { 'jse-theme-dark': isDarkMode }]"
        />
      </ClientOnly>
    </div>

    <!-- Preview Tab -->
    <div
      v-show="activeTab === 'preview'"
      class="flex-1 flex flex-col min-h-0"
    >
      <template v-if="showPreview">
        <!-- Import Errors -->
        <UAlert
          v-if="importErrors.length > 0"
          color="error"
          icon="i-lucide-alert-circle"
          title="Import Errors"
          class="shrink-0 mb-3"
        >
          <template #description>
            <ul class="list-disc list-inside space-y-1 mt-1 text-sm">
              <li
                v-for="(error, idx) in importErrors"
                :key="idx"
              >
                {{ error }}
              </li>
            </ul>
          </template>
        </UAlert>

        <!-- Unknown Locales -->
        <UAlert
          v-if="unknownLocales.length > 0"
          color="error"
          icon="i-lucide-alert-circle"
          title="Unknown languages"
          :description="`${unknownLocales.join(', ')} ${unknownLocales.length === 1 ? 'is' : 'are'} not in this project. Rename or remove ${unknownLocales.length === 1 ? 'it' : 'them'} before importing.`"
          class="shrink-0 mb-3"
        />

        <!-- Missing Locales -->
        <UAlert
          v-if="keysMissingLocales > 0"
          :color="requireAllLocales ? 'error' : 'warning'"
          icon="i-lucide-languages"
          :title="`${keysMissingLocales} key${keysMissingLocales === 1 ? '' : 's'} missing languages`"
          :description="requireAllLocales
            ? 'Every language is required for this project. Add the missing translations to import.'
            : 'These keys will be imported without a translation in some of the project\'s languages.'"
          class="shrink-0 mb-3"
        />

        <!-- Stats Bar -->
        <div class="shrink-0 mb-3 flex items-center gap-4 text-sm text-muted px-1">
          <span><span class="font-medium text-highlighted">{{ stats.total }}</span> keys</span>
          <span class="text-muted/50">·</span>
          <span class="text-success"><span class="font-medium">{{ stats.newKeys }}</span> new</span>
          <span
            v-if="stats.updateKeys > 0"
            class="text-warning"
          ><span class="font-medium">{{ stats.updateKeys }}</span> updates</span>
          <span
            v-if="stats.unchangedKeys > 0"
            class="text-muted"
          >(<span class="font-medium">{{ stats.unchangedKeys }}</span> unchanged)</span>
          <span class="text-muted/50">·</span>
          <span>{{ detectedLocales.map(getLocaleName).join(', ') }}</span>
        </div>

        <!-- Preview Table -->
        <div class="flex-1 min-h-0 border border-default rounded-lg overflow-auto">
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
                <td class="px-4 py-3">
                  <div class="font-mono text-sm">
                    {{ key.name }}
                  </div>
                  <div
                    v-if="missingLocales(key).length > 0"
                    class="text-xs text-warning mt-1"
                  >
                    Missing {{ missingLocales(key).length }}/{{ locales.length }}: {{ missingLocales(key).map(getLocaleName).join(', ') }}
                  </div>
                </td>
                <td
                  v-for="locale in detectedLocales"
                  :key="`${key.name}-${locale}`"
                  class="px-4 py-3 text-sm"
                >
                  <template v-if="key.translations[locale]">
                    <!-- Value changed: show word-level diff -->
                    <span
                      v-if="key.status === 'update' && key.existingTranslations?.[locale] && key.existingTranslations[locale] !== key.translations[locale]"
                      class="inline"
                    >
                      <template
                        v-for="(part, idx) in computeWordDiff(key.existingTranslations[locale], key.translations[locale])"
                        :key="idx"
                      >
                        <span
                          v-if="part.type === 'removed'"
                          class="bg-error/20 text-error line-through"
                        >{{ part.text }}</span>
                        <span
                          v-else-if="part.type === 'added'"
                          class="bg-success/20 text-success"
                        >{{ part.text }}</span>
                        <span v-else>{{ part.text }}</span>
                      </template>
                    </span>
                    <!-- No change -->
                    <span
                      v-else-if="key.status === 'update' && key.existingTranslations?.[locale] === key.translations[locale]"
                      class="text-muted"
                    >{{ key.translations[locale] }}</span>
                    <!-- New value (new key or new locale) -->
                    <span v-else>{{ key.translations[locale] }}</span>
                  </template>
                  <span
                    v-else
                    class="text-muted"
                  >—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- Empty state when no preview -->
      <div
        v-else
        class="flex-1 flex items-center justify-center text-muted"
      >
        <div class="text-center">
          <UIcon
            name="i-lucide-file-search"
            class="size-12 mb-3 opacity-50"
          />
          <p>Paste JSON in the Editor tab and click Verify</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.json-editor-container {
  --jse-theme-color: var(--ui-primary);
  --jse-theme-color-highlight: var(--ui-primary);
  height: 100%;
  border-radius: 0;
}

/* Make borders more subtle in dark mode */
.json-editor-container.jse-theme-dark {
  --jse-panel-border: rgba(255, 255, 255, 0.08);
  --jse-main-border: rgba(255, 255, 255, 0.08);
}

/* Target the main wrapper border in dark mode */
.json-editor-container.jse-theme-dark :deep(.jse-main) {
  border-color: rgba(255, 255, 255, 0.08) !important;
}

/* Status bar border */
.json-editor-container.jse-theme-dark :deep(.jse-status-bar) {
  border-top-color: rgba(255, 255, 255, 0.08) !important;
}

/* Line numbers gutter border */
.json-editor-container.jse-theme-dark :deep(.cm-gutters) {
  border-right-color: rgba(255, 255, 255, 0.08) !important;
}
</style>
