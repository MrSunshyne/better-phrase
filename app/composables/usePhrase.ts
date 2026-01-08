export interface PhraseProject {
  id: string
  name: string
  main_format: string
  created_at: string
  updated_at: string
  slug: string
}

const STORAGE_KEY = 'phrase_api_token'

export function usePhrase() {
  const token = useState<string>('phrase_token', () => '')
  const projects = useState<PhraseProject[]>('phrase_projects', () => [])
  const loading = useState<boolean>('phrase_loading', () => false)
  const error = useState<string | null>('phrase_error', () => null)
  const isConnected = computed(() => projects.value.length > 0)

  // Initialize token from localStorage on client side
  if (import.meta.client) {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      token.value = stored
    }
  }

  function saveToken(newToken: string) {
    token.value = newToken
    if (import.meta.client) {
      localStorage.setItem(STORAGE_KEY, newToken)
    }
  }

  function clearToken() {
    token.value = ''
    projects.value = []
    error.value = null
    if (import.meta.client) {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  async function fetchProjects(): Promise<boolean> {
    if (!token.value) {
      error.value = 'Please enter an API token'
      return false
    }

    loading.value = true
    error.value = null

    try {
      const response = await $fetch<PhraseProject[]>('https://api.phrase.com/v2/projects', {
        headers: {
          Authorization: `token ${token.value}`
        }
      })

      projects.value = response
      // Save token only after successful fetch
      saveToken(token.value)
      return true
    } catch (err: unknown) {
      const fetchError = err as { status?: number; message?: string }
      if (fetchError.status === 401) {
        error.value = 'Invalid API token. Please check your credentials.'
      } else {
        error.value = fetchError.message || 'Failed to fetch projects'
      }
      projects.value = []
      return false
    } finally {
      loading.value = false
    }
  }

  return {
    token,
    projects,
    loading,
    error,
    isConnected,
    saveToken,
    clearToken,
    fetchProjects
  }
}

