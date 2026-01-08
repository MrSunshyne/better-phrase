<script setup lang="ts">
const {
  locales,
  currentProject,
  activeLocales,
  setActiveLocales
} = usePhrase()

const isOpen = ref(false)
const selectedCodes = ref<string[]>([])

// Locale options for the select menu
const localeOptions = computed(() =>
  locales.value.map(locale => ({
    label: `${locale.name} (${locale.code})`,
    value: locale.code,
    locale
  }))
)

// Number of selected languages for the button label
const selectedCount = computed(() => activeLocales.value.length)

// Watch for modal open to sync with current selection
watch(isOpen, (open) => {
  if (open) {
    selectedCodes.value = [...activeLocales.value]
  }
})

function handleSave() {
  setActiveLocales(selectedCodes.value)
  isOpen.value = false
}

function handleCancel() {
  isOpen.value = false
}

function toggleLocale(code: string) {
  const index = selectedCodes.value.indexOf(code)
  if (index === -1) {
    selectedCodes.value.push(code)
  } else {
    selectedCodes.value.splice(index, 1)
  }
}

function isSelected(code: string) {
  return selectedCodes.value.includes(code)
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="Select Languages"
    description="Choose the languages you want to work with"
  >
    <UButton
      :disabled="!currentProject || locales.length === 0"
      color="neutral"
      variant="ghost"
      icon="i-lucide-languages"
      :label="selectedCount > 0 ? `${selectedCount} lang${selectedCount > 1 ? 's' : ''}` : 'Languages'"
      class="hidden sm:flex"
    />
    <UButton
      :disabled="!currentProject || locales.length === 0"
      color="neutral"
      variant="ghost"
      icon="i-lucide-languages"
      class="sm:hidden"
    />

    <template #body>
      <div
        v-if="locales.length === 0"
        class="text-center py-8 text-muted"
      >
        <UIcon
          name="i-lucide-globe"
          class="size-12 mb-4 opacity-50"
        />
        <p>No languages available.</p>
        <p class="text-sm mt-1">
          Open a project to see available languages.
        </p>
      </div>

      <div
        v-else
        class="space-y-3"
      >
        <p class="text-sm text-muted mb-4">
          Selected languages will be displayed in the translation editor.
        </p>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto">
          <button
            v-for="option in localeOptions"
            :key="option.value"
            type="button"
            class="flex items-center gap-3 p-3 rounded-lg border transition-all text-left"
            :class="[
              isSelected(option.value)
                ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                : 'border-default hover:border-muted hover:bg-elevated/50'
            ]"
            @click="toggleLocale(option.value)"
          >
            <div
              class="size-5 rounded border-2 flex items-center justify-center transition-colors"
              :class="[
                isSelected(option.value)
                  ? 'border-primary bg-primary'
                  : 'border-muted'
              ]"
            >
              <UIcon
                v-if="isSelected(option.value)"
                name="i-lucide-check"
                class="size-3 text-white"
              />
            </div>
            <div class="flex-1 min-w-0">
              <p class="font-medium text-highlighted truncate">
                {{ option.locale.name }}
              </p>
              <p class="text-xs text-muted">
                {{ option.locale.code }}
                <span
                  v-if="option.locale.default"
                  class="ml-1 text-primary"
                >(default)</span>
              </p>
            </div>
          </button>
        </div>

        <div
          v-if="selectedCodes.length > 0"
          class="pt-3 border-t border-default"
        >
          <p class="text-xs text-muted mb-2">
            Selected:
          </p>
          <div class="flex flex-wrap gap-1.5">
            <UBadge
              v-for="code in selectedCodes"
              :key="code"
              color="primary"
              variant="subtle"
              size="sm"
            >
              {{ locales.find(l => l.code === code)?.name || code }}
              <button
                type="button"
                class="ml-1 hover:text-primary"
                @click.stop="toggleLocale(code)"
              >
                <UIcon
                  name="i-lucide-x"
                  class="size-3"
                />
              </button>
            </UBadge>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          color="neutral"
          variant="outline"
          label="Cancel"
          @click="handleCancel"
        />
        <UButton
          :disabled="selectedCodes.length === 0"
          label="Save Selection"
          @click="handleSave"
        />
      </div>
    </template>
  </UModal>
</template>
