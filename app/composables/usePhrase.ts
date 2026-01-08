import type { CacheStore } from './useCache'

export interface PhraseProject {
  id: string
  name: string
  main_format: string
  created_at: string
  updated_at: string
  slug: string
  keys_count?: number
}

export interface PhraseLocale {
  id: string
  name: string
  code: string
  default: boolean
  main: boolean
  source_locale?: {
    id: string
    name: string
    code: string
  }
}

export interface PhraseKey {
  id: string
  name: string
  description: string
  name_hash: string
  plural: boolean
  tags: string[]
  created_at: string
  updated_at: string
}

export interface PhraseTranslation {
  id: string
  content: string
  unverified: boolean
  excluded: boolean
  plural_suffix: string
  key: {
    id: string
    name: string
  }
  locale: {
    id: string
    name: string
    code: string
  }
  created_at: string
  updated_at: string
}

export interface SyncStatus {
  lastSynced: number | null
  pendingChanges: number
  isSyncing: boolean
}

export interface FetchKeysOptions {
  page?: number
  perPage?: number
  sort?: string
  order?: 'asc' | 'desc'
  q?: string
}

const STORAGE_KEY = 'phrase_api_token'
const SELECTED_LOCALES_KEY = 'phrase_selected_locales'
const ACTIVE_LOCALES_KEY = 'phrase_active_locales'

export function usePhrase() {
  const cache = useCache()

  // Core state
  const token = useState<string>('phrase_token', () => '')
  const projects = useState<PhraseProject[]>('phrase_projects', () => [])
  const currentProject = useState<PhraseProject | null>('phrase_current_project', () => null)
  const locales = useState<PhraseLocale[]>('phrase_locales', () => [])
  const keys = useState<PhraseKey[]>('phrase_keys', () => [])
  const translations = useState<Map<string, PhraseTranslation[]>>('phrase_translations', () => new Map())

  // UI state
  const loading = useState<boolean>('phrase_loading', () => false)
  const error = useState<string | null>('phrase_error', () => null)
  const isConnected = computed(() => projects.value.length > 0)

  // Sync status
  const syncStatus = useState<SyncStatus>('phrase_sync_status', () => ({
    lastSynced: null,
    pendingChanges: 0,
    isSyncing: false
  }))

  // Selected locales per project (persisted) - legacy, kept for backwards compatibility
  const selectedLocales = useState<Record<string, string[]>>('phrase_selected_locales', () => ({}))

  // Global active locales (persisted) - the languages shown in the editor
  const activeLocales = useState<string[]>('phrase_active_locales', () => [])

  // Initialize from localStorage on client side
  if (import.meta.client) {
    const storedToken = localStorage.getItem(STORAGE_KEY)
    if (storedToken) {
      token.value = storedToken
    }

    const storedLocales = localStorage.getItem(SELECTED_LOCALES_KEY)
    if (storedLocales) {
      try {
        selectedLocales.value = JSON.parse(storedLocales)
      } catch {
        // Invalid JSON, ignore
      }
    }

    // Load active locales
    const storedActiveLocales = localStorage.getItem(ACTIVE_LOCALES_KEY)
    if (storedActiveLocales) {
      try {
        activeLocales.value = JSON.parse(storedActiveLocales)
      } catch {
        // Invalid JSON, ignore
      }
    }

    // Load sync status from cache
    cache.getSyncStatus().then((status) => {
      syncStatus.value.lastSynced = status.lastSynced
      syncStatus.value.pendingChanges = status.pendingChanges
    })
  }

  // Helper to make authenticated requests
  async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (!token.value) {
      throw new Error('No API token')
    }

    const response = await $fetch<T>(`https://api.phrase.com/v2${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `token ${token.value}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    })

    return response
  }

  // Token management
  function saveToken(newToken: string) {
    token.value = newToken
    if (import.meta.client) {
      localStorage.setItem(STORAGE_KEY, newToken)
    }
  }

  function clearToken() {
    token.value = ''
    projects.value = []
    currentProject.value = null
    locales.value = []
    keys.value = []
    translations.value = new Map()
    error.value = null
    if (import.meta.client) {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  // Selected locales management
  function getSelectedLocales(projectId: string): string[] {
    return selectedLocales.value[projectId] || []
  }

  function setSelectedLocales(projectId: string, localeCodes: string[]) {
    selectedLocales.value = {
      ...selectedLocales.value,
      [projectId]: localeCodes
    }
    if (import.meta.client) {
      localStorage.setItem(SELECTED_LOCALES_KEY, JSON.stringify(selectedLocales.value))
    }
  }

  // Global active locales management
  function setActiveLocales(localeCodes: string[]) {
    activeLocales.value = localeCodes
    if (import.meta.client) {
      localStorage.setItem(ACTIVE_LOCALES_KEY, JSON.stringify(localeCodes))
    }
  }

  // Initialize active locales with sensible defaults when locales are fetched
  function initializeActiveLocales(availableLocales: PhraseLocale[]) {
    if (activeLocales.value.length === 0 && availableLocales.length > 0) {
      // Default to 'en' and 'fr' if they exist, otherwise first 2 locales
      const defaultCodes = ['en', 'fr']
      const availableDefaults = defaultCodes.filter(code =>
        availableLocales.some(l => l.code === code)
      )
      const initialLocales = availableDefaults.length > 0
        ? availableDefaults
        : availableLocales.slice(0, 2).map(l => l.code)
      setActiveLocales(initialLocales)
    }
  }

  // Fetch projects (with cache)
  async function fetchProjects(forceRefresh = false): Promise<boolean> {
    if (!token.value) {
      error.value = 'Please enter an API token'
      return false
    }

    loading.value = true
    error.value = null

    try {
      // Check cache first
      if (!forceRefresh && import.meta.client) {
        const cached = await cache.getAllCached<PhraseProject>('projects')
        if (cached && !cached.isStale) {
          projects.value = cached.data
          loading.value = false
          return true
        }
      }

      // Fetch from API
      const response = await apiRequest<PhraseProject[]>('/projects')
      projects.value = response

      // Cache the results
      if (import.meta.client) {
        await cache.setCachedBulk(
          'projects',
          response.map(p => ({ id: p.id, data: p as unknown as Record<string, unknown> }))
        )
        await cache.updateLastSync()
        const status = await cache.getSyncStatus()
        syncStatus.value.lastSynced = status.lastSynced
        syncStatus.value.pendingChanges = status.pendingChanges
      }

      saveToken(token.value)
      return true
    } catch (err: unknown) {
      const fetchError = err as { status?: number, message?: string }
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

  // Fetch single project
  async function fetchProject(projectId: string, forceRefresh = false): Promise<PhraseProject | null> {
    if (!token.value) {
      error.value = 'Please enter an API token'
      return null
    }

    loading.value = true
    error.value = null

    try {
      // Check cache first
      if (!forceRefresh && import.meta.client) {
        const cached = await cache.getCached<PhraseProject>('projects', projectId)
        if (cached && !cached.isStale) {
          currentProject.value = cached.data
          loading.value = false

          // Background refresh if somewhat stale (> 2 min)
          if (Date.now() - cached.lastSynced > 2 * 60 * 1000) {
            fetchProject(projectId, true)
          }
          return cached.data
        }
      }

      // Fetch from API
      const response = await apiRequest<PhraseProject>(`/projects/${projectId}`)
      currentProject.value = response

      // Cache the result
      if (import.meta.client) {
        await cache.setCached('projects', projectId, response as unknown as Record<string, unknown>)
      }

      return response
    } catch (err: unknown) {
      const fetchError = err as { status?: number, message?: string }
      error.value = fetchError.message || 'Failed to fetch project'
      return null
    } finally {
      loading.value = false
    }
  }

  // Fetch locales for a project
  async function fetchLocales(projectId: string, forceRefresh = false): Promise<PhraseLocale[]> {
    if (!token.value) return []

    try {
      // Check cache first
      if (!forceRefresh && import.meta.client) {
        const cached = await cache.getAllCached<PhraseLocale>('locales', { projectId })
        if (cached && !cached.isStale) {
          locales.value = cached.data
          return cached.data
        }
      }

      // Fetch from API
      const response = await apiRequest<PhraseLocale[]>(`/projects/${projectId}/locales`)
      locales.value = response

      // Initialize active locales with defaults if not set
      initializeActiveLocales(response)

      // Cache the results
      if (import.meta.client) {
        await cache.setCachedBulk(
          'locales',
          response.map(l => ({ id: l.id, data: l as unknown as Record<string, unknown>, projectId }))
        )
      }

      return response
    } catch (err: unknown) {
      console.error('Failed to fetch locales:', err)
      return []
    }
  }

  // Fetch keys for a project
  async function fetchKeys(
    projectId: string,
    options: FetchKeysOptions = {},
    forceRefresh = false
  ): Promise<{ keys: PhraseKey[], hasMore: boolean, total?: number }> {
    if (!token.value) return { keys: [], hasMore: false }

    const {
      page = 1,
      perPage = 20,
      sort = 'created_at',
      order = 'desc',
      q
    } = options

    try {
      // Build query params
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        sort,
        order
      })
      if (q) params.append('q', q)

      // For the first page without search, check cache
      if (!forceRefresh && page === 1 && !q && import.meta.client) {
        const cached = await cache.getAllCached<PhraseKey>('keys', { projectId })
        if (cached && !cached.isStale && cached.data.length >= perPage) {
          keys.value = cached.data.slice(0, perPage)
          return { keys: keys.value, hasMore: cached.data.length > perPage }
        }
      }

      // Fetch from API with headers to get total count
      let total: number | undefined
      const response = await $fetch<PhraseKey[]>(
        `https://api.phrase.com/v2/projects/${projectId}/keys?${params.toString()}`,
        {
          headers: {
            'Authorization': `token ${token.value}`,
            'Content-Type': 'application/json'
          },
          onResponse({ response: res }) {
            // Phrase API returns pagination info in headers
            const pagination = res.headers.get('Pagination')
            if (pagination) {
              try {
                const paginationData = JSON.parse(pagination)
                total = paginationData.total_count
              } catch {
                // Ignore parsing errors
              }
            }
          }
        }
      )
      keys.value = response

      // Cache the results (only first page without search)
      if (import.meta.client && page === 1 && !q) {
        await cache.setCachedBulk(
          'keys',
          response.map(k => ({ id: k.id, data: k as unknown as Record<string, unknown>, projectId }))
        )
      }

      return {
        keys: response,
        hasMore: response.length === perPage,
        total
      }
    } catch (err: unknown) {
      console.error('Failed to fetch keys:', err)
      return { keys: [], hasMore: false }
    }
  }

  // Fetch translations for a specific key
  async function fetchTranslations(
    projectId: string,
    keyId: string,
    forceRefresh = false
  ): Promise<PhraseTranslation[]> {
    if (!token.value) return []

    try {
      // Check if we already have translations for this key
      const existing = translations.value.get(keyId)
      if (!forceRefresh && existing && existing.length > 0) {
        return existing
      }

      // Fetch from API
      const response = await apiRequest<PhraseTranslation[]>(
        `/projects/${projectId}/translations?key_id=${keyId}`
      )

      // Store in state
      translations.value.set(keyId, response)

      return response
    } catch (err: unknown) {
      console.error('Failed to fetch translations:', err)
      return []
    }
  }

  // Fetch all translations for displayed keys (batch)
  async function fetchTranslationsForKeys(
    projectId: string,
    keyIds: string[]
  ): Promise<void> {
    if (!token.value || keyIds.length === 0) return

    try {
      // Batch key IDs into groups to reduce API calls
      // Phrase API limits to 4 concurrent requests per user
      const BATCH_SIZE = 4
      const batches: string[][] = []

      for (let i = 0; i < keyIds.length; i += BATCH_SIZE) {
        batches.push(keyIds.slice(i, i + BATCH_SIZE))
      }

      // Process batches sequentially to avoid rate limiting
      for (const batch of batches) {
        const promises = batch.map(keyId =>
          apiRequest<PhraseTranslation[]>(
            `/projects/${projectId}/translations?key_id=${keyId}`
          ).then(trans => ({ keyId, translations: trans }))
        )

        const results = await Promise.all(promises)

        // Update state for this batch
        for (const { keyId, translations: trans } of results) {
          translations.value.set(keyId, trans)
        }
      }
    } catch (err: unknown) {
      console.error('Failed to fetch translations:', err)
    }
  }

  // Update a translation
  async function updateTranslation(
    projectId: string,
    translationId: string,
    localeId: string,
    keyId: string,
    content: string
  ): Promise<boolean> {
    if (!token.value) return false

    // Optimistic update
    const keyTranslations = translations.value.get(keyId) || []
    const translationIndex = keyTranslations.findIndex(t => t.id === translationId)
    const oldContent = translationIndex >= 0 ? keyTranslations[translationIndex]?.content : ''

    if (translationIndex >= 0) {
      keyTranslations[translationIndex] = {
        ...keyTranslations[translationIndex],
        content
      }
      translations.value.set(keyId, [...keyTranslations])
    }

    // Mark as dirty in cache
    if (import.meta.client) {
      await cache.markDirty('translations', translationId)
      syncStatus.value.pendingChanges++
    }

    try {
      syncStatus.value.isSyncing = true

      await apiRequest(`/projects/${projectId}/translations/${translationId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content })
      })

      // Clear dirty flag
      if (import.meta.client) {
        await cache.clearDirty('translations', translationId)
        syncStatus.value.pendingChanges = Math.max(0, syncStatus.value.pendingChanges - 1)
      }

      return true
    } catch (err: unknown) {
      // Revert optimistic update on failure
      if (translationIndex >= 0 && oldContent !== undefined) {
        keyTranslations[translationIndex] = {
          ...keyTranslations[translationIndex],
          content: oldContent
        }
        translations.value.set(keyId, [...keyTranslations])
      }

      console.error('Failed to update translation:', err)
      return false
    } finally {
      syncStatus.value.isSyncing = false
    }
  }

  // Create a new translation (for keys without translations in a locale)
  async function createTranslation(
    projectId: string,
    localeId: string,
    keyId: string,
    content: string
  ): Promise<PhraseTranslation | null> {
    if (!token.value) return null

    try {
      syncStatus.value.isSyncing = true

      const response = await apiRequest<PhraseTranslation>(
        `/projects/${projectId}/translations`,
        {
          method: 'POST',
          body: JSON.stringify({
            locale_id: localeId,
            key_id: keyId,
            content
          })
        }
      )

      // Update state
      const keyTranslations = translations.value.get(keyId) || []
      keyTranslations.push(response)
      translations.value.set(keyId, keyTranslations)

      return response
    } catch (err: unknown) {
      console.error('Failed to create translation:', err)
      return null
    } finally {
      syncStatus.value.isSyncing = false
    }
  }

  // Force sync all pending changes
  async function syncAll(): Promise<boolean> {
    if (syncStatus.value.pendingChanges === 0) return true

    syncStatus.value.isSyncing = true

    try {
      // Get all dirty translations from cache
      if (import.meta.client) {
        const dirtyTranslations = await cache.getDirtyItems<PhraseTranslation>('translations')

        for (const translation of dirtyTranslations) {
          try {
            await apiRequest(
              `/projects/${translation.key.id}/translations/${translation.id}`,
              {
                method: 'PATCH',
                body: JSON.stringify({ content: translation.content })
              }
            )
            await cache.clearDirty('translations', translation.id)
          } catch {
            // Continue with other translations
          }
        }

        const status = await cache.getSyncStatus()
        syncStatus.value.pendingChanges = status.pendingChanges
        syncStatus.value.lastSynced = Date.now()
        await cache.updateLastSync()
      }

      return true
    } catch (err) {
      console.error('Sync failed:', err)
      return false
    } finally {
      syncStatus.value.isSyncing = false
    }
  }

  // Clear all local data
  async function clearLocalData(): Promise<void> {
    if (import.meta.client) {
      await cache.clearCache()
      // Also clear selected locales from localStorage
      localStorage.removeItem(SELECTED_LOCALES_KEY)
    }
    currentProject.value = null
    locales.value = []
    keys.value = []
    translations.value = new Map()
    selectedLocales.value = {}
    syncStatus.value = {
      lastSynced: null,
      pendingChanges: 0,
      isSyncing: false
    }
  }

  // ============================================
  // Bulk Operations (Phase 2)
  // ============================================

  interface ExistingKeyInfo {
    id: string
    name: string
    translations: Record<string, string>
  }

  // Check which keys already exist in a project
  async function checkKeysExist(
    projectId: string,
    keyNames: string[]
  ): Promise<ExistingKeyInfo[]> {
    if (!token.value || keyNames.length === 0) return []

    const existingKeys: ExistingKeyInfo[] = []

    try {
      // Search for each key by name (Phrase API q parameter searches key names)
      // We'll batch these requests to avoid overwhelming the API
      const batchSize = 10
      for (let i = 0; i < keyNames.length; i += batchSize) {
        const batch = keyNames.slice(i, i + batchSize)
        const promises = batch.map(async (keyName) => {
          try {
            // Search for the exact key name
            const response = await apiRequest<PhraseKey[]>(
              `/projects/${projectId}/keys?q=${encodeURIComponent(keyName)}&per_page=100`
            )
            // Find exact match
            const exactMatch = response.find(k => k.name === keyName)
            if (exactMatch) {
              // Fetch translations for this key
              const translations = await apiRequest<PhraseTranslation[]>(
                `/projects/${projectId}/translations?key_id=${exactMatch.id}`
              )
              const translationsMap: Record<string, string> = {}
              for (const t of translations) {
                translationsMap[t.locale.code] = t.content
              }
              return {
                id: exactMatch.id,
                name: exactMatch.name,
                translations: translationsMap
              }
            }
            return null
          } catch {
            return null
          }
        })

        const results = await Promise.all(promises)
        for (const result of results) {
          if (result) {
            existingKeys.push(result)
          }
        }
      }

      return existingKeys
    } catch (err) {
      console.error('Failed to check existing keys:', err)
      return []
    }
  }

  interface BulkCreateKeyData {
    name: string
    translations: Record<string, string>
  }

  // Bulk create keys with translations
  async function bulkCreateKeys(
    projectId: string,
    keysData: BulkCreateKeyData[]
  ): Promise<{ created: number, errors: number, errorDetails: string[] }> {
    if (!token.value || keysData.length === 0) {
      return { created: 0, errors: 0, errorDetails: [] }
    }

    let created = 0
    let errors = 0
    const errorDetails: string[] = []

    syncStatus.value.isSyncing = true

    try {
      // Get locale IDs for translation creation
      const projectLocales = locales.value.length > 0
        ? locales.value
        : await fetchLocales(projectId)

      const localeIdMap: Record<string, string> = {}
      for (const locale of projectLocales) {
        localeIdMap[locale.code] = locale.id
      }

      for (const keyData of keysData) {
        try {
          // Create the key
          const key = await apiRequest<PhraseKey>(
            `/projects/${projectId}/keys`,
            {
              method: 'POST',
              body: JSON.stringify({ name: keyData.name })
            }
          )

          // Create translations for each locale
          for (const [localeCode, content] of Object.entries(keyData.translations)) {
            const localeId = localeIdMap[localeCode]
            if (localeId && content) {
              try {
                await apiRequest(
                  `/projects/${projectId}/translations`,
                  {
                    method: 'POST',
                    body: JSON.stringify({
                      locale_id: localeId,
                      key_id: key.id,
                      content
                    })
                  }
                )
              } catch {
                // Continue with other translations
              }
            }
          }

          created++
        } catch (err) {
          console.error(`Failed to create key ${keyData.name}:`, err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          errorDetails.push(`${keyData.name}: ${errorMsg}`)
          errors++
        }
      }

      // Refresh the keys list
      await fetchKeys(projectId, { page: 1, perPage: 20 }, true)

      return { created, errors, errorDetails }
    } finally {
      syncStatus.value.isSyncing = false
    }
  }

  interface BulkUpdateData {
    keyName: string
    translations: Record<string, string>
  }

  // Bulk update translations for existing keys
  async function bulkUpdateTranslations(
    projectId: string,
    updates: BulkUpdateData[]
  ): Promise<{ updated: number, errors: number, errorDetails: string[] }> {
    if (!token.value || updates.length === 0) {
      return { updated: 0, errors: 0, errorDetails: [] }
    }

    let updated = 0
    let errors = 0
    const errorDetails: string[] = []

    syncStatus.value.isSyncing = true

    try {
      // Get locale IDs for translation creation
      const projectLocales = locales.value.length > 0
        ? locales.value
        : await fetchLocales(projectId)

      const localeIdMap: Record<string, string> = {}
      for (const locale of projectLocales) {
        localeIdMap[locale.code] = locale.id
      }

      for (const update of updates) {
        try {
          // Find the key
          const response = await apiRequest<PhraseKey[]>(
            `/projects/${projectId}/keys?q=${encodeURIComponent(update.keyName)}&per_page=100`
          )
          const key = response.find(k => k.name === update.keyName)

          if (!key) {
            console.warn(`Key not found: ${update.keyName}`)
            errorDetails.push(`${update.keyName}: Key not found`)
            errors++
            continue
          }

          // Get existing translations for this key
          const existingTranslations = await apiRequest<PhraseTranslation[]>(
            `/projects/${projectId}/translations?key_id=${key.id}`
          )

          // Update or create translations
          for (const [localeCode, content] of Object.entries(update.translations)) {
            const localeId = localeIdMap[localeCode]
            if (!localeId) continue

            const existing = existingTranslations.find(t => t.locale.code === localeCode)

            try {
              if (existing) {
                // Update existing translation
                await apiRequest(
                  `/projects/${projectId}/translations/${existing.id}`,
                  {
                    method: 'PATCH',
                    body: JSON.stringify({ content })
                  }
                )
              } else {
                // Create new translation
                await apiRequest(
                  `/projects/${projectId}/translations`,
                  {
                    method: 'POST',
                    body: JSON.stringify({
                      locale_id: localeId,
                      key_id: key.id,
                      content
                    })
                  }
                )
              }
            } catch (localeErr) {
              const errorMsg = localeErr instanceof Error ? localeErr.message : String(localeErr)
              errorDetails.push(`${update.keyName} (${localeCode}): ${errorMsg}`)
            }
          }

          updated++
        } catch (err) {
          console.error(`Failed to update key ${update.keyName}:`, err)
          const errorMsg = err instanceof Error ? err.message : String(err)
          errorDetails.push(`${update.keyName}: ${errorMsg}`)
          errors++
        }
      }

      // Refresh the keys list
      await fetchKeys(projectId, { page: 1, perPage: 20 }, true)

      return { updated, errors, errorDetails }
    } finally {
      syncStatus.value.isSyncing = false
    }
  }

  return {
    // State
    token,
    projects,
    currentProject,
    locales,
    keys,
    translations,
    loading,
    error,
    isConnected,
    syncStatus,
    selectedLocales,
    activeLocales,

    // Token management
    saveToken,
    clearToken,

    // Locale selection (legacy per-project)
    getSelectedLocales,
    setSelectedLocales,

    // Global active locales
    setActiveLocales,

    // Data fetching
    fetchProjects,
    fetchProject,
    fetchLocales,
    fetchKeys,
    fetchTranslations,
    fetchTranslationsForKeys,

    // Data mutation
    updateTranslation,
    createTranslation,

    // Bulk operations
    checkKeysExist,
    bulkCreateKeys,
    bulkUpdateTranslations,

    // Sync
    syncAll,
    clearLocalData
  }
}
