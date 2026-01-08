<script setup lang="ts">
import type { PhraseKey } from '~/composables/usePhrase'

const route = useRoute()
const router = useRouter()

const projectId = computed(() => route.params.id as string)

const {
  currentProject,
  locales,
  loading,
  error,
  activeLocales,
  setActiveLocales,
  fetchProject,
  fetchLocales
} = usePhrase()

const toast = useToast()

// Load project and locales
onMounted(async () => {
  const [project] = await Promise.all([
    fetchProject(projectId.value),
    fetchLocales(projectId.value)
  ])

  if (!project) {
    toast.add({
      title: 'Project not found',
      description: 'The requested project could not be loaded',
      color: 'error',
      icon: 'i-lucide-x-circle'
    })
    router.push('/')
    return
  }
})

function goBack() {
  router.push('/')
}

// Search state
const searchQuery = ref('')

function clearSearch() {
  searchQuery.value = ''
}

// KeysEditor ref
const keysEditorRef = ref<{
  keys: PhraseKey[]
  isLoadingKeys: boolean
  debouncedSearch: string
  hasSearched: boolean
  loadKeys: (reset?: boolean) => Promise<void>
  copyAllKeys: () => Promise<void>
  triggerSearch: () => void
} | null>(null)

// Handle search on Enter key
function handleSearchKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    keysEditorRef.value?.triggerSearch()
  }
}

function setDefaultLanguages() {
  const defaultCodes = ['en', 'fr']
  const availableDefaults = defaultCodes.filter(code =>
    locales.value.some(l => l.code === code)
  )
  if (availableDefaults.length > 0) {
    setActiveLocales(availableDefaults)
  }
}
</script>

<template>
  <div class="px-4 py-2 h-full flex flex-col">
    <!-- Combined Header -->
    <div class="flex items-center justify-between mb-2 shrink-0 border-b border-default pb-2">
      <!-- Left: Logo + Back + Title + Stats -->
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
            {{ currentProject?.name || 'Loading...' }}
          </h1>
          <span class="text-xs text-muted">·</span>
          <span class="text-xs text-muted flex items-center gap-1">
            <UIcon
              name="i-lucide-languages"
              class="size-3"
            />
            {{ locales.length }}
          </span>
          <span class="text-xs text-muted flex items-center gap-1">
            <UIcon
              name="i-lucide-key"
              class="size-3"
            />
            {{ currentProject?.keys_count || '—' }}
          </span>
        </div>
      </div>

      <!-- Right: Actions + App Controls -->
      <div class="flex items-center gap-2">
        <SyncStatus />
        <UButton
          :to="`/projects/${projectId}/add-keys`"
          icon="i-lucide-plus"
          color="primary"
          size="xs"
        >
          Add Keys
        </UButton>
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

    <!-- Loading State -->
    <div
      v-if="loading && !currentProject"
      class="flex-1 flex items-center justify-center"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="size-8 animate-spin text-muted"
      />
    </div>

    <!-- Error State -->
    <div
      v-else-if="error"
      class="flex-1 flex items-center justify-center"
    >
      <div class="flex flex-col items-center text-center">
        <UIcon
          name="i-lucide-alert-circle"
          class="size-12 mb-4 text-error opacity-50"
        />
        <h3 class="text-lg font-medium text-highlighted mb-2">
          Error Loading Project
        </h3>
        <p class="text-muted max-w-md mb-4">
          {{ error }}
        </p>
        <UButton
          icon="i-lucide-refresh-cw"
          @click="fetchProject(projectId)"
        >
          Try Again
        </UButton>
      </div>
    </div>

    <!-- Project Content -->
    <template v-else-if="currentProject">
      <!-- Active Languages Info -->
      <UCard
        v-if="activeLocales.length === 0"
        variant="subtle"
        class="max-w-6xl mx-auto w-full mb-3 shrink-0"
      >
        <div class="flex items-center justify-between gap-4 py-1">
          <div class="flex items-center gap-3">
            <UIcon
              name="i-lucide-info"
              class="size-5 text-info shrink-0"
            />
            <p class="text-sm text-muted">
              Select languages using the
              <UIcon
                name="i-lucide-languages"
                class="inline-block size-4"
              />
              button above
            </p>
          </div>
          <UButton
            v-if="locales.some(l => l.code === 'en') || locales.some(l => l.code === 'fr')"
            color="primary"
            variant="soft"
            size="xs"
            @click="setDefaultLanguages"
          >
            Set EN & FR
          </UButton>
        </div>
      </UCard>

      <!-- Keys Editor -->
      <div class="flex-1 min-h-0 flex flex-col border border-default rounded-lg overflow-hidden">
        <div
          v-if="activeLocales.length > 0"
          class="shrink-0 px-3 py-2 border-b border-default bg-elevated/30 flex items-center justify-between gap-4"
        >
          <!-- Left: Search + Actions -->
          <div class="flex items-center gap-2 flex-1">
            <UInput
              v-model="searchQuery"
              icon="i-lucide-search"
              placeholder="Search keys... (Enter to search)"
              size="sm"
              class="w-80"
              @keydown="handleSearchKeydown"
            >
              <template
                v-if="searchQuery"
                #trailing
              >
                <UButton
                  color="neutral"
                  variant="link"
                  size="xs"
                  icon="i-lucide-x"
                  class="h-4 w-4"
                  @click="clearSearch"
                />
              </template>
            </UInput>

            <UButton
              color="primary"
              variant="soft"
              size="xs"
              icon="i-lucide-search"
              :loading="keysEditorRef?.isLoadingKeys"
              :disabled="!searchQuery"
              @click="keysEditorRef?.triggerSearch()"
            >
              Search
            </UButton>

            <UButton
              v-if="keysEditorRef?.hasSearched && keysEditorRef?.debouncedSearch"
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-refresh-cw"
              :loading="keysEditorRef?.isLoadingKeys"
              @click="keysEditorRef?.loadKeys(true)"
            >
              Refresh
            </UButton>

            <UButton
              v-if="keysEditorRef?.keys && keysEditorRef.keys.length > 0"
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-copy"
              @click="keysEditorRef?.copyAllKeys()"
            >
              Copy All ({{ keysEditorRef.keys.length }})
            </UButton>
          </div>

          <!-- Right: Selected languages -->
          <div class="flex items-center gap-1.5">
            <span class="text-xs text-muted">Editing:</span>
            <UBadge
              v-for="code in activeLocales"
              :key="code"
              color="primary"
              variant="subtle"
              size="xs"
            >
              {{ locales.find(l => l.code === code)?.name || code }}
            </UBadge>
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-auto">
          <KeysEditor
            ref="keysEditorRef"
            v-model:search="searchQuery"
            :project-id="projectId"
            :selected-locales="activeLocales"
            :locales="locales"
          />
        </div>
      </div>
    </template>
  </div>
</template>
