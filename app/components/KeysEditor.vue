<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { PhraseKey, PhraseLocale, PhraseTranslation } from '~/composables/usePhrase'

const props = defineProps<{
  projectId: string
  selectedLocales: string[]
  locales: PhraseLocale[]
}>()

const {
  keys,
  translations,
  fetchKeys,
  fetchTranslationsForKeys,
  updateTranslation,
  createTranslation
} = usePhrase()

const toast = useToast()

// State
const searchQuery = ref('')
const debouncedSearch = ref('')
const currentPage = ref(1)
const perPage = 20
const hasMore = ref(false)
const isLoadingKeys = ref(false)
const isLoadingTranslations = ref(false)

// Editing state
const editingCell = ref<{ keyId: string; localeCode: string } | null>(null)
const editingValue = ref('')
const isSaving = ref(false)

// Debounce search query
let searchTimeout: ReturnType<typeof setTimeout> | null = null
watch(searchQuery, (newVal) => {
  if (searchTimeout) {
    clearTimeout(searchTimeout)
  }
  searchTimeout = setTimeout(() => {
    debouncedSearch.value = newVal
  }, 300)
})

// Selected locales as full objects
const selectedLocaleObjects = computed(() =>
  props.locales.filter(l => props.selectedLocales.includes(l.code))
)

// Dynamic columns based on selected locales
const columns = computed<TableColumn<PhraseKey>[]>(() => {
  const baseColumns: TableColumn<PhraseKey>[] = [
    {
      accessorKey: 'name',
      header: 'Key',
      meta: {
        class: {
          td: 'font-mono text-sm max-w-xs truncate'
        }
      }
    }
  ]

  // Add a column for each selected locale
  for (const locale of selectedLocaleObjects.value) {
    baseColumns.push({
      id: `locale_${locale.code}`,
      header: locale.name,
      meta: {
        class: {
          th: 'min-w-[200px]',
          td: 'min-w-[200px]'
        }
      }
    })
  }

  return baseColumns
})

// Get translation for a key and locale
function getTranslation(keyId: string, localeCode: string): PhraseTranslation | undefined {
  const keyTranslations = translations.value.get(keyId) || []
  return keyTranslations.find(t => t.locale.code === localeCode)
}

// Load keys and translations
async function loadKeys(reset = false) {
  if (reset) {
    currentPage.value = 1
  }

  isLoadingKeys.value = true

  try {
    const result = await fetchKeys(props.projectId, {
      page: currentPage.value,
      perPage,
      sort: 'created_at',
      order: 'desc',
      q: debouncedSearch.value || undefined
    })

    hasMore.value = result.hasMore

    // Load translations for the fetched keys
    if (result.keys.length > 0) {
      isLoadingTranslations.value = true
      await fetchTranslationsForKeys(
        props.projectId,
        result.keys.map(k => k.id)
      )
      isLoadingTranslations.value = false
    }
  } finally {
    isLoadingKeys.value = false
  }
}

// Initial load
onMounted(() => {
  loadKeys()
})

// Reload when search changes
watch(debouncedSearch, () => {
  loadKeys(true)
})

// Reload when selected locales change
watch(() => props.selectedLocales, () => {
  if (keys.value.length > 0) {
    fetchTranslationsForKeys(props.projectId, keys.value.map(k => k.id))
  }
})

// Pagination
function nextPage() {
  if (hasMore.value) {
    currentPage.value++
    loadKeys()
  }
}

function prevPage() {
  if (currentPage.value > 1) {
    currentPage.value--
    loadKeys()
  }
}

// Inline editing
function startEditing(keyId: string, localeCode: string) {
  const translation = getTranslation(keyId, localeCode)
  editingCell.value = { keyId, localeCode }
  editingValue.value = translation?.content || ''
}

function cancelEditing() {
  editingCell.value = null
  editingValue.value = ''
}

async function saveEditing() {
  if (!editingCell.value) return

  const { keyId, localeCode } = editingCell.value
  const translation = getTranslation(keyId, localeCode)
  const locale = props.locales.find(l => l.code === localeCode)

  if (!locale) return

  isSaving.value = true

  try {
    let success: boolean

    if (translation) {
      // Update existing translation
      success = await updateTranslation(
        props.projectId,
        translation.id,
        locale.id,
        keyId,
        editingValue.value
      )
    } else {
      // Create new translation
      const result = await createTranslation(
        props.projectId,
        locale.id,
        keyId,
        editingValue.value
      )
      success = result !== null
    }

    if (success) {
      toast.add({
        title: 'Saved',
        description: 'Translation updated successfully',
        color: 'success',
        icon: 'i-lucide-check'
      })
    } else {
      toast.add({
        title: 'Error',
        description: 'Failed to save translation',
        color: 'error',
        icon: 'i-lucide-x'
      })
    }
  } finally {
    isSaving.value = false
    editingCell.value = null
    editingValue.value = ''
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    saveEditing()
  } else if (event.key === 'Escape') {
    cancelEditing()
  }
}

// Check if a cell is being edited
function isEditing(keyId: string, localeCode: string): boolean {
  return editingCell.value?.keyId === keyId && editingCell.value?.localeCode === localeCode
}
</script>

<template>
  <div class="space-y-4">
    <!-- Search and Controls -->
    <div class="flex items-center gap-4">
      <UInput
        v-model="searchQuery"
        icon="i-lucide-search"
        placeholder="Search keys..."
        class="flex-1 max-w-sm"
        :disabled="isLoadingKeys"
      />

      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-refresh-cw"
        :loading="isLoadingKeys"
        @click="loadKeys(true)"
      >
        Refresh
      </UButton>
    </div>

    <!-- No Locales Selected Warning -->
    <UAlert
      v-if="selectedLocales.length === 0"
      color="warning"
      icon="i-lucide-alert-triangle"
      title="No languages selected"
      description="Please select at least one language above to view and edit translations."
    />

    <!-- Keys Table -->
    <div v-else class="border border-default rounded-lg overflow-hidden">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-default">
          <thead class="bg-elevated/50">
            <tr>
              <th class="px-4 py-3 text-left text-sm font-semibold text-highlighted">
                Key
              </th>
              <th
                v-for="locale in selectedLocaleObjects"
                :key="locale.code"
                class="px-4 py-3 text-left text-sm font-semibold text-highlighted min-w-[250px]"
              >
                {{ locale.name }}
                <span class="text-muted font-normal">({{ locale.code }})</span>
              </th>
            </tr>
          </thead>

          <tbody class="divide-y divide-default">
            <!-- Loading State -->
            <tr v-if="isLoadingKeys && keys.length === 0">
              <td :colspan="selectedLocales.length + 1" class="px-4 py-8 text-center">
                <div class="flex flex-col items-center gap-2 text-muted">
                  <UIcon name="i-lucide-loader-2" class="size-8 animate-spin" />
                  <span>Loading keys...</span>
                </div>
              </td>
            </tr>

            <!-- Empty State -->
            <tr v-else-if="keys.length === 0">
              <td :colspan="selectedLocales.length + 1" class="px-4 py-8 text-center">
                <div class="flex flex-col items-center gap-2 text-muted">
                  <UIcon name="i-lucide-file-x" class="size-12 opacity-50" />
                  <span>{{ searchQuery ? 'No keys match your search' : 'No keys found' }}</span>
                </div>
              </td>
            </tr>

            <!-- Key Rows -->
            <tr
              v-for="key in keys"
              :key="key.id"
              class="hover:bg-elevated/30 transition-colors"
            >
              <!-- Key Name -->
              <td class="px-4 py-3">
                <div class="font-mono text-sm text-highlighted truncate max-w-xs" :title="key.name">
                  {{ key.name }}
                </div>
                <div v-if="key.description" class="text-xs text-muted truncate max-w-xs">
                  {{ key.description }}
                </div>
              </td>

              <!-- Translation Cells -->
              <td
                v-for="locale in selectedLocaleObjects"
                :key="`${key.id}-${locale.code}`"
                class="px-4 py-2 min-w-[250px]"
              >
                <!-- Editing Mode -->
                <div v-if="isEditing(key.id, locale.code)" class="space-y-2">
                  <UTextarea
                    v-model="editingValue"
                    :rows="2"
                    autofocus
                    class="w-full text-sm"
                    @keydown="handleKeydown"
                  />
                  <div class="flex gap-2">
                    <UButton
                      size="xs"
                      icon="i-lucide-check"
                      :loading="isSaving"
                      @click="saveEditing"
                    >
                      Save
                    </UButton>
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="outline"
                      icon="i-lucide-x"
                      :disabled="isSaving"
                      @click="cancelEditing"
                    >
                      Cancel
                    </UButton>
                  </div>
                </div>

                <!-- Display Mode -->
                <div
                  v-else
                  class="group cursor-pointer rounded p-2 -m-2 hover:bg-elevated/50 transition-colors min-h-[40px] flex items-start"
                  @click="startEditing(key.id, locale.code)"
                >
                  <span
                    v-if="getTranslation(key.id, locale.code)?.content"
                    class="text-sm text-highlighted"
                  >
                    {{ getTranslation(key.id, locale.code)?.content }}
                  </span>
                  <span v-else class="text-sm text-muted italic">
                    Click to add translation...
                  </span>
                  <UIcon
                    name="i-lucide-pencil"
                    class="size-4 ml-auto opacity-0 group-hover:opacity-50 shrink-0"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="keys.length > 0" class="flex items-center justify-between">
      <p class="text-sm text-muted">
        Showing {{ keys.length }} key{{ keys.length === 1 ? '' : 's' }}
        <span v-if="searchQuery"> matching "{{ searchQuery }}"</span>
      </p>

      <div class="flex items-center gap-2">
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-chevron-left"
          :disabled="currentPage === 1 || isLoadingKeys"
          @click="prevPage"
        >
          Previous
        </UButton>
        <span class="text-sm text-muted px-2">
          Page {{ currentPage }}
        </span>
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          trailing-icon="i-lucide-chevron-right"
          :disabled="!hasMore || isLoadingKeys"
          @click="nextPage"
        >
          Next
        </UButton>
      </div>
    </div>

    <!-- Loading Translations Indicator -->
    <div v-if="isLoadingTranslations" class="flex items-center gap-2 text-sm text-muted">
      <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
      <span>Loading translations...</span>
    </div>
  </div>
</template>

