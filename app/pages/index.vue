<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui'
import type { PhraseProject } from '~/composables/usePhrase'

const router = useRouter()
const { token, projects, loading, error, isConnected, clearToken, fetchProjects } = usePhrase()
const toast = useToast()

const showToken = ref(false)
const inputToken = ref('')

// Initialize inputToken from stored token
onMounted(() => {
  if (token.value) {
    inputToken.value = token.value
    // Auto-fetch projects if we have a stored token
    fetchProjects()
  }
})

const columns: TableColumn<PhraseProject>[] = [
  {
    accessorKey: 'name',
    header: 'Project Name'
  },
  {
    accessorKey: 'id',
    header: 'ID'
  },
  {
    accessorKey: 'main_format',
    header: 'Format'
  },
  {
    accessorKey: 'created_at',
    header: 'Created',
    cell: ({ row }) => {
      return new Date(row.getValue('created_at')).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    }
  }
]

async function handleConnect() {
  // Update the token in the composable before fetching
  token.value = inputToken.value

  const success = await fetchProjects()

  if (success) {
    toast.add({
      title: 'Connected successfully',
      description: `Found ${projects.value.length} project(s)`,
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
  } else if (error.value) {
    toast.add({
      title: 'Connection failed',
      description: error.value,
      color: 'error',
      icon: 'i-lucide-x-circle'
    })
  }
}

function handleDisconnect() {
  clearToken()
  inputToken.value = ''
  toast.add({
    title: 'Disconnected',
    description: 'Your API token has been cleared',
    color: 'neutral',
    icon: 'i-lucide-log-out'
  })
}

function handleProjectSelect(_event: Event, row: TableRow<PhraseProject>) {
  router.push(`/projects/${row.original.id}`)
}
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 py-12">
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-highlighted mb-2">
        Better Phrase
      </h1>
      <p class="text-muted">
        Manage your Phrase projects with ease
      </p>
    </div>

    <!-- Token Input Card -->
    <UCard class="mb-8">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-key" class="size-5 text-primary" />
          <h2 class="font-semibold text-highlighted">
            API Token
          </h2>
        </div>
      </template>

      <div class="space-y-4">
        <UFormField label="Phrase API Token" name="token" help="Enter your Phrase API access token to connect">
          <UInput
            v-model="inputToken"
            :type="showToken ? 'text' : 'password'"
            placeholder="Enter your API token"
            :disabled="loading"
            :ui="{ trailing: 'pe-1' }"
            class="w-full"
          >
            <template #trailing>
              <UButton
                color="neutral"
                variant="link"
                size="sm"
                :icon="showToken ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="showToken ? 'Hide token' : 'Show token'"
                @click="showToken = !showToken"
              />
            </template>
          </UInput>
        </UFormField>

        <div class="flex gap-2">
          <UButton
            :loading="loading"
            :disabled="!inputToken || loading"
            icon="i-lucide-plug"
            @click="handleConnect"
          >
            {{ isConnected ? 'Refresh' : 'Connect' }}
          </UButton>

          <UButton
            v-if="isConnected"
            color="neutral"
            variant="outline"
            icon="i-lucide-log-out"
            @click="handleDisconnect"
          >
            Disconnect
          </UButton>
        </div>
      </div>
    </UCard>

    <!-- Projects Table Card -->
    <UCard v-if="isConnected || loading">
      <template #header>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-folder" class="size-5 text-primary" />
            <h2 class="font-semibold text-highlighted">
              Projects
            </h2>
          </div>
          <UBadge v-if="projects.length" color="neutral" variant="subtle">
            {{ projects.length }} project{{ projects.length === 1 ? '' : 's' }}
          </UBadge>
        </div>
      </template>

      <UTable
        :data="projects"
        :columns="columns"
        :loading="loading"
        class="w-full cursor-pointer"
        @select="handleProjectSelect"
      >
        <template #empty>
          <div class="flex flex-col items-center justify-center py-8 text-muted">
            <UIcon name="i-lucide-folder-open" class="size-12 mb-2 opacity-50" />
            <p>No projects found</p>
          </div>
        </template>
      </UTable>
    </UCard>

    <!-- Initial State - Not Connected -->
    <UCard v-else variant="subtle">
      <div class="flex flex-col items-center justify-center py-12 text-center">
        <UIcon name="i-lucide-cloud-off" class="size-16 mb-4 text-muted opacity-50" />
        <h3 class="text-lg font-medium text-highlighted mb-2">
          Not Connected
        </h3>
        <p class="text-muted max-w-md">
          Enter your Phrase API token above to view and manage your projects.
          You can generate a token in your
          <UButton
            to="https://app.phrase.com/settings/oauth_access_tokens"
            target="_blank"
            variant="link"
            class="p-0 h-auto"
          >
            Phrase settings
          </UButton>.
        </p>
      </div>
    </UCard>
  </div>
</template>
