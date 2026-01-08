<script setup lang="ts">
const { syncStatus, syncAll, clearLocalData } = usePhrase()
const cache = useCache()
const toast = useToast()

const isOpen = ref(false)

const statusIcon = computed(() => {
  if (syncStatus.value.isSyncing) return 'i-lucide-loader-2'
  if (syncStatus.value.pendingChanges > 0) return 'i-lucide-cloud-upload'
  return 'i-lucide-cloud-check'
})

const statusColor = computed(() => {
  if (syncStatus.value.isSyncing) return 'neutral'
  if (syncStatus.value.pendingChanges > 0) return 'warning'
  return 'success'
})

const statusText = computed(() => {
  if (syncStatus.value.isSyncing) return 'Syncing...'
  if (syncStatus.value.pendingChanges > 0) {
    return `${syncStatus.value.pendingChanges} pending`
  }
  return 'Synced'
})

const lastSyncedText = computed(() => {
  if (!syncStatus.value.lastSynced) return 'Never synced'

  const diff = Date.now() - syncStatus.value.lastSynced
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  return new Date(syncStatus.value.lastSynced).toLocaleDateString()
})

async function handleSync() {
  const success = await syncAll()
  if (success) {
    toast.add({
      title: 'Sync complete',
      description: 'All changes have been synced',
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
  } else {
    toast.add({
      title: 'Sync failed',
      description: 'Some changes could not be synced',
      color: 'error',
      icon: 'i-lucide-x-circle'
    })
  }
}

async function handleClearCache() {
  await clearLocalData()
  await cache.clearCache()
  isOpen.value = false
  toast.add({
    title: 'Cache cleared',
    description: 'All local data has been removed',
    color: 'neutral',
    icon: 'i-lucide-trash-2'
  })
}
</script>

<template>
  <UPopover v-model:open="isOpen">
    <UButton
      :color="statusColor"
      variant="ghost"
      size="sm"
      :icon="statusIcon"
      :class="{ 'animate-spin': syncStatus.isSyncing }"
    >
      <span class="hidden sm:inline">{{ statusText }}</span>
      <UBadge
        v-if="syncStatus.pendingChanges > 0"
        :color="statusColor"
        variant="solid"
        size="xs"
        class="ml-1"
      >
        {{ syncStatus.pendingChanges }}
      </UBadge>
    </UButton>

    <template #content>
      <div class="p-4 w-64">
        <div class="flex items-center gap-2 mb-3">
          <UIcon
            :name="statusIcon"
            :class="[
              'size-5',
              syncStatus.isSyncing ? 'animate-spin text-muted' : '',
              syncStatus.pendingChanges > 0 ? 'text-warning' : 'text-success'
            ]"
          />
          <span class="font-medium text-highlighted">{{ statusText }}</span>
        </div>

        <div class="space-y-2 text-sm text-muted mb-4">
          <div class="flex justify-between">
            <span>Last synced:</span>
            <span class="text-highlighted">{{ lastSyncedText }}</span>
          </div>
          <div class="flex justify-between">
            <span>Pending changes:</span>
            <span class="text-highlighted">{{ syncStatus.pendingChanges }}</span>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <UButton
            :loading="syncStatus.isSyncing"
            :disabled="syncStatus.pendingChanges === 0"
            icon="i-lucide-refresh-cw"
            block
            @click="handleSync"
          >
            Sync Now
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-trash-2"
            block
            @click="handleClearCache"
          >
            Clear Cache
          </UButton>
        </div>
      </div>
    </template>
  </UPopover>
</template>

