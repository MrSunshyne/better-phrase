<script setup lang="ts">
const route = useRoute()
const router = useRouter()

const projectId = computed(() => route.params.id as string)

const {
  currentProject,
  locales,
  loading,
  error,
  fetchProject,
  fetchLocales,
  getSelectedLocales,
  setSelectedLocales
} = usePhrase()

const toast = useToast()

// Local state for language selector
const selectedLocaleCodes = ref<string[]>([])

// Locale options for the select menu
const localeOptions = computed(() =>
  locales.value.map(locale => ({
    label: `${locale.name} (${locale.code})`,
    value: locale.code,
    locale
  }))
)

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

  // Load previously selected locales or use defaults
  const stored = getSelectedLocales(projectId.value)
  if (stored.length > 0) {
    // User has previously selected locales - use those
    selectedLocaleCodes.value = stored
  } else if (locales.value.length > 0) {
    // Default to 'en' and 'fr' if they exist in the project
    const defaultCodes = ['en', 'fr']
    const availableDefaults = defaultCodes.filter(code =>
      locales.value.some(l => l.code === code)
    )
    selectedLocaleCodes.value = availableDefaults.length > 0
      ? availableDefaults
      : locales.value.slice(0, 2).map(l => l.code) // Fallback to first 2 if en/fr don't exist
  }
})

// Watch for locale selection changes
watch(selectedLocaleCodes, (newCodes) => {
  setSelectedLocales(projectId.value, newCodes)
})

// Format date helper
function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

function goBack() {
  router.push('/')
}
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-8">
    <!-- Header -->
    <div class="flex items-center justify-between mb-8">
      <div class="flex items-center gap-4">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          @click="goBack"
        />
        <div>
          <h1 class="text-2xl font-bold text-highlighted">
            {{ currentProject?.name || 'Loading...' }}
          </h1>
          <p class="text-sm text-muted">
            {{ projectId }}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <SyncStatus />
        <UButton
          :to="`/projects/${projectId}/add-keys`"
          icon="i-lucide-plus"
          color="primary"
        >
          Add Keys
        </UButton>
      </div>
    </div>

    <!-- Loading State -->
    <div
      v-if="loading && !currentProject"
      class="space-y-4"
    >
      <USkeleton class="h-32 w-full" />
      <USkeleton class="h-64 w-full" />
    </div>

    <!-- Error State -->
    <UCard
      v-else-if="error"
      variant="subtle"
    >
      <div class="flex flex-col items-center justify-center py-12 text-center">
        <UIcon
          name="i-lucide-alert-circle"
          class="size-16 mb-4 text-error opacity-50"
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
    </UCard>

    <!-- Project Content -->
    <div
      v-else-if="currentProject"
      class="space-y-6"
    >
      <!-- Language Selector Card -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-languages"
              class="size-5 text-primary"
            />
            <h2 class="font-semibold text-highlighted">
              Working Languages
            </h2>
          </div>
        </template>

        <div class="space-y-4">
          <p class="text-sm text-muted">
            Select the languages you want to work with. Only these languages will be shown in the editor.
          </p>

          <USelectMenu
            v-model="selectedLocaleCodes"
            :items="localeOptions"
            multiple
            placeholder="Select languages..."
            value-key="value"
            class="w-full max-w-md"
          >
            <template #label>
              <span v-if="selectedLocaleCodes.length === 0">Select languages...</span>
              <span v-else>{{ selectedLocaleCodes.length }} language{{ selectedLocaleCodes.length > 1 ? 's' : '' }} selected</span>
            </template>
          </USelectMenu>

          <div
            v-if="selectedLocaleCodes.length > 0"
            class="flex flex-wrap gap-2"
          >
            <UBadge
              v-for="code in selectedLocaleCodes"
              :key="code"
              color="primary"
              variant="subtle"
            >
              {{ locales.find(l => l.code === code)?.name || code }}
            </UBadge>
          </div>
        </div>
      </UCard>

      <!-- Overview Cards -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <UCard variant="subtle">
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-lg bg-primary/10">
              <UIcon
                name="i-lucide-languages"
                class="size-5 text-primary"
              />
            </div>
            <div>
              <p class="text-sm text-muted">
                Languages
              </p>
              <p class="text-xl font-semibold text-highlighted">
                {{ locales.length }}
              </p>
            </div>
          </div>
        </UCard>

        <UCard variant="subtle">
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-lg bg-success/10">
              <UIcon
                name="i-lucide-key"
                class="size-5 text-success"
              />
            </div>
            <div>
              <p class="text-sm text-muted">
                Keys
              </p>
              <p class="text-xl font-semibold text-highlighted">
                {{ currentProject.keys_count || '—' }}
              </p>
            </div>
          </div>
        </UCard>

        <UCard variant="subtle">
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-lg bg-info/10">
              <UIcon
                name="i-lucide-file-code"
                class="size-5 text-info"
              />
            </div>
            <div>
              <p class="text-sm text-muted">
                Format
              </p>
              <p class="text-xl font-semibold text-highlighted">
                {{ currentProject.main_format || '—' }}
              </p>
            </div>
          </div>
        </UCard>

        <UCard variant="subtle">
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-lg bg-warning/10">
              <UIcon
                name="i-lucide-calendar"
                class="size-5 text-warning"
              />
            </div>
            <div>
              <p class="text-sm text-muted">
                Created
              </p>
              <p class="text-xl font-semibold text-highlighted">
                {{ formatDate(currentProject.created_at) }}
              </p>
            </div>
          </div>
        </UCard>
      </div>

      <!-- Keys Editor -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-file-text"
                class="size-5 text-primary"
              />
              <h2 class="font-semibold text-highlighted">
                Translation Keys
              </h2>
            </div>
          </div>
        </template>

        <KeysEditor
          :project-id="projectId"
          :selected-locales="selectedLocaleCodes"
          :locales="locales"
        />
      </UCard>
    </div>
  </div>
</template>
