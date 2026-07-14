import { useState } from 'react'
import { Search, Mic, Shirt } from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/layout/PageHeader'
import AIChip from '../components/ai/AIChip'
import SceneAlbumCard from '../components/media/SceneAlbumCard'
import MasonryGrid from '../components/media/MasonryGrid'
import MediaLightbox from '../components/media/MediaLightbox'
import LoadingSkeleton from '../components/ui/LoadingSkeleton'
import EmptyState from '../components/ui/EmptyState'
import { WARDROBE_FILTERS } from '../lib/constants'
import { useSceneAlbums, useWardrobe, searchMedia, searchTranscripts } from '../hooks/useApi'

const TABS = [
  { id: 'search', label: 'Search', icon: Search },
  { id: 'albums', label: 'Smart Albums', icon: null },
  { id: 'wardrobe', label: 'Wardrobe', icon: Shirt },
  { id: 'spoken', label: 'Spoken', icon: Mic },
]

export default function ExplorePage() {
  const [tab, setTab] = useState('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [lightboxId, setLightboxId] = useState(null)
  const [albumResults, setAlbumResults] = useState(null)

  const { data: sceneAlbums, isLoading: albumsLoading } = useSceneAlbums()
  const { data: wardrobeItems } = useWardrobe()

  async function handleSearch(e) {
    e?.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setSearched(true)
    try {
      if (tab === 'spoken') {
        const items = await searchTranscripts(query)
        setResults(items)
      } else {
        const data = await searchMedia(query)
        setResults(data.results || [])
      }
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  async function openAlbum(tag) {
    setTab('search')
    setQuery(tag)
    setLoading(true)
    setSearched(true)
    try {
      const data = await searchMedia(tag)
      setResults(data.results || [])
      setAlbumResults(tag)
    } finally {
      setLoading(false)
    }
  }

  async function wardrobeFilter(filterQuery) {
    setTab('search')
    setQuery(filterQuery)
    setLoading(true)
    setSearched(true)
    try {
      const data = await searchMedia(filterQuery)
      setResults(data.results || [])
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <PageHeader
        title="Explore"
        subtitle="Semantic search, smart albums, wardrobe catalog, and spoken memories from your videos."
        action={<AIChip>CLIP + FTS search</AIChip>}
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id)
                setSearched(false)
                setResults([])
              }}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
                tab === t.id
                  ? 'bg-terracotta text-white'
                  : 'border border-border bg-card text-ink-muted hover:text-ink'
              }`}
            >
              {Icon && <Icon size={16} />}
              {t.label}
            </button>
          )
        })}
      </div>

      {(tab === 'search' || tab === 'spoken') && (
        <form onSubmit={handleSearch} className="mb-8 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              tab === 'spoken'
                ? 'Search words spoken in videos...'
                : 'Search naturally: food in 2025, selfie with Maa...'
            }
            className="input-journal flex-1"
          />
          <button type="submit" disabled={loading} className="btn-primary">
            <Search size={18} />
            Search
          </button>
        </form>
      )}

      {tab === 'albums' && (
        <div>
          {albumsLoading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              <LoadingSkeleton className="aspect-[4/3]" count={8} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {(sceneAlbums || []).map((album) => (
                <SceneAlbumCard
                  key={album.tag}
                  tag={album.tag}
                  count={album.count}
                  coverId={album.cover_id}
                  onClick={() => openAlbum(album.tag)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'wardrobe' && (
        <div>
          <div className="mb-6 flex flex-wrap gap-2">
            {WARDROBE_FILTERS.map((f) => (
              <button
                key={f.query}
                type="button"
                onClick={() => wardrobeFilter(f.query)}
                className="rounded-full border border-border bg-card px-4 py-2 text-sm text-ink transition hover:border-terracotta hover:text-terracotta"
              >
                {f.label}
              </button>
            ))}
          </div>
          <MasonryGrid
            items={wardrobeItems || []}
            onSelect={(item) => setLightboxId(item.id)}
          />
        </div>
      )}

      {(tab === 'search' || tab === 'spoken') && (
        <div>
          {loading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <LoadingSkeleton className="aspect-square" count={8} />
            </div>
          ) : searched && results.length === 0 ? (
            <EmptyState title="No results" description="Try a different search query." />
          ) : results.length > 0 ? (
            <>
              {albumResults && (
                <p className="mb-4 text-sm text-ink-muted">
                  Showing results for <strong className="text-ink">{albumResults}</strong>
                </p>
              )}
              <MasonryGrid items={results} onSelect={(item) => setLightboxId(item.id)} />
            </>
          ) : null}
        </div>
      )}

      <MediaLightbox
        mediaId={lightboxId}
        onClose={() => setLightboxId(null)}
        onSelectMedia={setLightboxId}
      />
    </motion.div>
  )
}
