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
  rateLimited: boolean
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
const MAX_PER_PAGE = 100
// Phrase's rate limit resets every 5 minutes and the browser can't read its reset header,
// so back off on a fixed schedule that spans a full window before giving up
const RATE_LIMIT_RETRY_DELAYS = [5, 15, 30, 60, 60, 60, 90].map(seconds => seconds * 1000)
const UPLOAD_DONE_STATES = ['success', 'error']
const UPLOAD_POLL_INTERVAL = 1500
const UPLOAD_TIMEOUT = 5 * 60 * 1000

// Read the page count from the Link header's rel=last URL (Link is CORS-exposed, Pagination is not)
function lastPageFromLink(link: string | null): number | undefined {
  const last = link?.split(',').find(part => /rel="?last"?/.test(part))
  const page = last?.match(/[?&]page=(\d+)/)?.[1]
  return page === undefined ? undefined : Number(page)
}

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
    isSyncing: false,
    rateLimited: false
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

    for (let attempt = 0; ; attempt++) {
      try {
        return await $fetch<T>(`https://api.phrase.com/v2${endpoint}`, {
          ...options,
          headers: {
            Authorization: `token ${token.value}`,
            // Let the browser set the multipart boundary for file uploads
            ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
            ...options.headers
          }
        })
      } catch (err: unknown) {
        const delay = RATE_LIMIT_RETRY_DELAYS[attempt]
        if ((err as { status?: number }).status !== 429 || delay === undefined) throw err

        console.warn(`Phrase rate limit reached, retrying in ${delay / 1000}s`)
        syncStatus.value.rateLimited = true
        await new Promise(resolve => setTimeout(resolve, delay))
        syncStatus.value.rateLimited = false
      }
    }
  }

  // Fetch every page of a list endpoint. Phrase returns 25 items per page by default,
  // and the browser can't read its Pagination header (not CORS-exposed), so stop on a short page.
  async function apiRequestAll<T>(endpoint: string): Promise<T[]> {
    const separator = endpoint.includes('?') ? '&' : '?'
    const items: T[] = []
    for (let page = 1; ; page++) {
      const batch = await apiRequest<T[]>(`${endpoint}${separator}page=${page}&per_page=${MAX_PER_PAGE}`)
      items.push(...batch)
      if (batch.length < MAX_PER_PAGE) return items
    }
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

  // Resolve a locale by code, falling back to name (a locale can be named "zh-CN" with code "zh-Hans")
  function findLocale(identifier: string): PhraseLocale | undefined {
    return locales.value.find(l => l.code === identifier)
      ?? locales.value.find(l => l.name === identifier)
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
      const response = await apiRequestAll<PhraseLocale>(`/projects/${projectId}/locales`)
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
  ): Promise<{ keys: PhraseKey[], hasMore: boolean, totalPages?: number }> {
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

      // Fetch from API with headers to get the page count
      let totalPages: number | undefined
      const response = await $fetch<PhraseKey[]>(
        `https://api.phrase.com/v2/projects/${projectId}/keys?${params.toString()}`,
        {
          headers: {
            'Authorization': `token ${token.value}`,
            'Content-Type': 'application/json'
          },
          onResponse({ response: res }) {
            totalPages = lastPageFromLink(res.headers.get('Link'))
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
        hasMore: totalPages === undefined ? response.length === perPage : page < totalPages,
        totalPages
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
      const response = await apiRequestAll<PhraseTranslation>(
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
          apiRequestAll<PhraseTranslation>(
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
      isSyncing: false,
      rateLimited: false
    }
  }

  // ============================================
  // Bulk Operations (Phase 2)
  // ============================================

  // Find a key by its exact name. `name:` is an exact-match query, but it can't express
  // whitespace, so names with spaces fall back to a broad search over every page.
  async function findKeyByName(projectId: string, keyName: string): Promise<PhraseKey | undefined> {
    const q = /\s/.test(keyName) ? keyName : `name:${keyName}`
    const response = await apiRequestAll<PhraseKey>(
      `/projects/${projectId}/keys?q=${encodeURIComponent(q)}`
    )
    return response.find(k => k.name === keyName)
  }

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
            const exactMatch = await findKeyByName(projectId, keyName)
            if (exactMatch) {
              // Fetch translations for this key
              const translations = await apiRequestAll<PhraseTranslation>(
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

  interface ImportKeyData {
    name: string
    translations: Record<string, string>
  }

  interface PhraseUpload {
    id: string
    state: string
    error_message: string | null
    summary: {
      translation_keys_created: number
      translations_created: number
      translations_updated: number
    }
  }

  // Upload one locale's translations as a flat JSON file
  async function uploadLocaleFile(
    projectId: string,
    locale: PhraseLocale,
    translations: Record<string, string>
  ): Promise<PhraseUpload> {
    const form = new FormData()
    form.append('file', new Blob([JSON.stringify(translations)], { type: 'application/json' }), `${locale.code}.json`)
    form.append('file_format', 'simple_json')
    form.append('locale_id', locale.id)
    form.append('update_translations', 'true')
    form.append('skip_upload_tags', 'true')

    return apiRequest<PhraseUpload>(`/projects/${projectId}/uploads`, {
      method: 'POST',
      body: form
    })
  }

  // Poll the project's recent uploads (one request per round) until the given uploads finish
  async function waitForUploads(projectId: string, uploads: PhraseUpload[]): Promise<Map<string, PhraseUpload>> {
    const finished = new Map<string, PhraseUpload>()
    for (const upload of uploads) {
      if (UPLOAD_DONE_STATES.includes(upload.state)) finished.set(upload.id, upload)
    }

    const deadline = Date.now() + UPLOAD_TIMEOUT
    while (finished.size < uploads.length && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, UPLOAD_POLL_INTERVAL))
      const recent = await apiRequest<PhraseUpload[]>(`/projects/${projectId}/uploads?per_page=${MAX_PER_PAGE}`)
      for (const upload of recent) {
        if (UPLOAD_DONE_STATES.includes(upload.state) && uploads.some(u => u.id === upload.id)) {
          finished.set(upload.id, upload)
        }
      }
    }

    return finished
  }

  // Create or update keys with one file upload per locale instead of one request per translation,
  // which keeps large imports well under Phrase's rate limit
  async function importTranslations(
    projectId: string,
    keysData: ImportKeyData[]
  ): Promise<{ keysCreated: number, translationsCreated: number, translationsUpdated: number, errorDetails: string[] }> {
    const result = { keysCreated: 0, translationsCreated: 0, translationsUpdated: 0, errorDetails: [] as string[] }
    if (!token.value || keysData.length === 0) return result

    syncStatus.value.isSyncing = true

    try {
      const projectLocales = locales.value.length > 0
        ? locales.value
        : await fetchLocales(projectId)

      // Group translations into one file per locale
      const files = new Map<string, Record<string, string>>()
      for (const keyData of keysData) {
        for (const [localeCode, content] of Object.entries(keyData.translations)) {
          if (!content) continue
          if (!projectLocales.some(l => l.code === localeCode)) {
            result.errorDetails.push(`${keyData.name} (${localeCode}): locale not in this project`)
            continue
          }
          files.set(localeCode, { ...files.get(localeCode), [keyData.name]: content })
        }
      }

      // Default locale first, then the locales covering the most keys
      const uploadLocales = projectLocales
        .filter(l => files.has(l.code))
        .sort((a, b) => Number(b.default) - Number(a.default)
          || Object.keys(files.get(b.code)!).length - Object.keys(files.get(a.code)!).length)

      // An upload creates the keys it mentions. Wait for uploads one by one until every key
      // exists, so concurrent uploads never race to create the same key; then send the rest at once.
      const uncreatedKeys = new Set(keysData.map(k => k.name))
      const uploads: { locale: PhraseLocale, upload: PhraseUpload }[] = []

      for (const locale of uploadLocales) {
        const translations = files.get(locale.code)!
        try {
          const upload = await uploadLocaleFile(projectId, locale, translations)
          uploads.push({ locale, upload })

          const createsKeys = Object.keys(translations).some(name => uncreatedKeys.has(name))
          if (createsKeys) {
            const finished = await waitForUploads(projectId, [upload])
            if (finished.get(upload.id)?.state === 'success') {
              Object.keys(translations).forEach(name => uncreatedKeys.delete(name))
            }
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          result.errorDetails.push(`${locale.name}: upload failed: ${errorMsg}`)
        }
      }

      const finished = await waitForUploads(projectId, uploads.map(u => u.upload))

      for (const { locale, upload } of uploads) {
        const done = finished.get(upload.id)
        if (!done) {
          result.errorDetails.push(`${locale.name}: upload still processing in Phrase, check the project's uploads`)
        } else if (done.state !== 'success') {
          result.errorDetails.push(`${locale.name}: ${done.error_message || 'upload failed'}`)
        } else {
          result.keysCreated += done.summary.translation_keys_created
          result.translationsCreated += done.summary.translations_created
          result.translationsUpdated += done.summary.translations_updated
        }
      }

      // Refresh the keys list
      await fetchKeys(projectId, { page: 1, perPage: 20 }, true)

      return result
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
    findLocale,

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
    importTranslations,

    // Sync
    syncAll,
    clearLocalData
  }
}
