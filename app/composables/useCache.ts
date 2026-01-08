import Dexie, { type EntityTable } from 'dexie'

// Cache entry interfaces
export interface CachedProject {
  id: string
  data: Record<string, unknown>
  lastSynced: number
  dirty: boolean
}

export interface CachedLocale {
  id: string
  projectId: string
  data: Record<string, unknown>
  lastSynced: number
}

export interface CachedKey {
  id: string
  projectId: string
  data: Record<string, unknown>
  lastSynced: number
}

export interface CachedTranslation {
  id: string
  projectId: string
  keyId: string
  localeCode: string
  content: string
  lastSynced: number
  dirty: boolean
}

export interface SyncMeta {
  key: string
  value: string | number
}

// Database class
class PhraseDatabase extends Dexie {
  projects!: EntityTable<CachedProject, 'id'>
  locales!: EntityTable<CachedLocale, 'id'>
  keys!: EntityTable<CachedKey, 'id'>
  translations!: EntityTable<CachedTranslation, 'id'>
  syncMeta!: EntityTable<SyncMeta, 'key'>

  constructor() {
    super('PhraseCache')
    this.version(1).stores({
      projects: 'id, lastSynced, dirty',
      locales: 'id, projectId, lastSynced',
      keys: 'id, projectId, lastSynced',
      translations: 'id, projectId, keyId, localeCode, lastSynced, dirty',
      syncMeta: 'key'
    })
  }
}

// Singleton database instance
let db: PhraseDatabase | null = null

function getDb(): PhraseDatabase {
  if (!db) {
    db = new PhraseDatabase()
  }
  return db
}

// Cache duration constants (in milliseconds)
const CACHE_DURATION = {
  projects: 5 * 60 * 1000, // 5 minutes
  locales: 30 * 60 * 1000, // 30 minutes
  keys: 5 * 60 * 1000, // 5 minutes
  translations: 5 * 60 * 1000 // 5 minutes
}

export type CacheStore = 'projects' | 'locales' | 'keys' | 'translations'

export function useCache() {
  const isInitialized = useState('cache_initialized', () => false)

  // Initialize database
  async function initDatabase(): Promise<void> {
    if (isInitialized.value) return
    try {
      const database = getDb()
      await database.open()
      isInitialized.value = true
    } catch (error) {
      console.error('Failed to initialize IndexedDB:', error)
    }
  }

  // Check if cached data is stale
  function isStale(lastSynced: number, store: CacheStore): boolean {
    const duration = CACHE_DURATION[store]
    return Date.now() - lastSynced > duration
  }

  // Get cached item
  async function getCached<T>(
    store: CacheStore,
    id: string
  ): Promise<{ data: T; lastSynced: number; isStale: boolean } | null> {
    try {
      const database = getDb()
      const item = await database[store].get(id)
      if (!item) return null

      return {
        data: item.data as T,
        lastSynced: item.lastSynced,
        isStale: isStale(item.lastSynced, store)
      }
    } catch (error) {
      console.error(`Failed to get cached ${store}:`, error)
      return null
    }
  }

  // Get all cached items for a store
  async function getAllCached<T>(
    store: CacheStore,
    filter?: { projectId?: string }
  ): Promise<{ data: T[]; lastSynced: number; isStale: boolean } | null> {
    try {
      const database = getDb()
      let items

      if (filter?.projectId) {
        items = await database[store].where('projectId').equals(filter.projectId).toArray()
      } else {
        items = await database[store].toArray()
      }

      if (!items.length) return null

      const oldestSync = Math.min(...items.map(i => i.lastSynced))
      return {
        data: items.map(i => i.data) as T[],
        lastSynced: oldestSync,
        isStale: isStale(oldestSync, store)
      }
    } catch (error) {
      console.error(`Failed to get all cached ${store}:`, error)
      return null
    }
  }

  // Set cached item
  async function setCached(
    store: CacheStore,
    id: string,
    data: Record<string, unknown>,
    extra?: { projectId?: string; keyId?: string; localeCode?: string }
  ): Promise<void> {
    try {
      const database = getDb()
      const entry = {
        id,
        data,
        lastSynced: Date.now(),
        dirty: false,
        ...extra
      }
      await database[store].put(entry as never)
    } catch (error) {
      console.error(`Failed to set cached ${store}:`, error)
    }
  }

  // Set multiple cached items
  async function setCachedBulk(
    store: CacheStore,
    items: Array<{ id: string; data: Record<string, unknown>; projectId?: string }>
  ): Promise<void> {
    try {
      const database = getDb()
      const now = Date.now()
      const entries = items.map(item => ({
        id: item.id,
        data: item.data,
        lastSynced: now,
        dirty: false,
        projectId: item.projectId
      }))
      await database[store].bulkPut(entries as never[])
    } catch (error) {
      console.error(`Failed to bulk set cached ${store}:`, error)
    }
  }

  // Mark item as dirty (has local changes)
  async function markDirty(store: 'projects' | 'translations', id: string): Promise<void> {
    try {
      const database = getDb()
      await database[store].update(id, { dirty: true })
    } catch (error) {
      console.error(`Failed to mark ${store} as dirty:`, error)
    }
  }

  // Clear dirty flag
  async function clearDirty(store: 'projects' | 'translations', id: string): Promise<void> {
    try {
      const database = getDb()
      await database[store].update(id, { dirty: false, lastSynced: Date.now() })
    } catch (error) {
      console.error(`Failed to clear dirty flag for ${store}:`, error)
    }
  }

  // Get all dirty items
  async function getDirtyItems<T>(store: 'projects' | 'translations'): Promise<T[]> {
    try {
      const database = getDb()
      const items = await database[store].where('dirty').equals(1).toArray()
      return items.map(i => i.data) as T[]
    } catch (error) {
      console.error(`Failed to get dirty ${store}:`, error)
      return []
    }
  }

  // Get sync status
  async function getSyncStatus(): Promise<{
    lastSynced: number | null
    pendingChanges: number
  }> {
    try {
      const database = getDb()
      const meta = await database.syncMeta.get('lastGlobalSync')
      const dirtyProjects = await database.projects.where('dirty').equals(1).count()
      const dirtyTranslations = await database.translations.where('dirty').equals(1).count()

      return {
        lastSynced: meta ? Number(meta.value) : null,
        pendingChanges: dirtyProjects + dirtyTranslations
      }
    } catch (error) {
      console.error('Failed to get sync status:', error)
      return { lastSynced: null, pendingChanges: 0 }
    }
  }

  // Update last sync time
  async function updateLastSync(): Promise<void> {
    try {
      const database = getDb()
      await database.syncMeta.put({ key: 'lastGlobalSync', value: Date.now() })
    } catch (error) {
      console.error('Failed to update last sync:', error)
    }
  }

  // Clear all cache
  async function clearCache(): Promise<void> {
    try {
      const database = getDb()
      await Promise.all([
        database.projects.clear(),
        database.locales.clear(),
        database.keys.clear(),
        database.translations.clear(),
        database.syncMeta.clear()
      ])
    } catch (error) {
      console.error('Failed to clear cache:', error)
    }
  }

  // Clear cache for a specific project
  async function clearProjectCache(projectId: string): Promise<void> {
    try {
      const database = getDb()
      await Promise.all([
        database.projects.delete(projectId),
        database.locales.where('projectId').equals(projectId).delete(),
        database.keys.where('projectId').equals(projectId).delete(),
        database.translations.where('projectId').equals(projectId).delete()
      ])
    } catch (error) {
      console.error('Failed to clear project cache:', error)
    }
  }

  // Initialize on client side
  if (import.meta.client) {
    initDatabase()
  }

  return {
    initDatabase,
    isStale,
    getCached,
    getAllCached,
    setCached,
    setCachedBulk,
    markDirty,
    clearDirty,
    getDirtyItems,
    getSyncStatus,
    updateLastSync,
    clearCache,
    clearProjectCache
  }
}

