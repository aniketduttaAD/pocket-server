import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Play, Square, RefreshCw, Eye, Copy } from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import StatRibbon from '../components/ui/StatRibbon'
import DuplicateGroupCard from '../components/media/DuplicateGroupCard'
import MediaLightbox from '../components/media/MediaLightbox'
import LoadingSkeleton from '../components/ui/LoadingSkeleton'
import { api } from '../api'
import { useStatus, useDuplicates } from '../hooks/useApi'

export default function StudioPage() {
  const [watching, setWatching] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [progress, setProgress] = useState(null)
  const [lightboxId, setLightboxId] = useState(null)
  const [dupGroup, setDupGroup] = useState(null)
  const wsRef = useRef(null)

  const { data: status, refetch: refetchStatus } = useStatus()
  const { data: duplicates, isLoading: dupsLoading } = useDuplicates()

  useEffect(() => {
    return () => wsRef.current?.close()
  }, [])

  function connectWs() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/progress`)
    ws.onmessage = (e) => {
      try {
        setProgress(JSON.parse(e.data))
      } catch {}
    }
    wsRef.current = ws
  }

  async function startIngest(full = false) {
    setIngesting(true)
    connectWs()
    try {
      await api('/api/ingest', {
        method: 'POST',
        body: JSON.stringify({ full }),
      })
      refetchStatus()
    } catch (err) {
      console.error(err)
    } finally {
      setIngesting(false)
      setProgress(null)
    }
  }

  async function toggleWatch() {
    if (watching) {
      await api('/api/watch/stop', { method: 'POST' })
      setWatching(false)
    } else {
      await api('/api/watch/start', { method: 'POST' })
      setWatching(true)
      connectWs()
    }
  }

  async function reviewDuplicates(group) {
    setDupGroup(group)
    if (group.representative?.id) {
      setLightboxId(group.representative.id)
    }
  }

  const stats = status?.stats || {}

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <PageHeader
        title="Studio"
        subtitle="Indexing controls, duplicate cleanup, and system status for your memory engine."
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatRibbon label="Embeddings" value={stats.embeddings || 0} />
        <StatRibbon label="Transcripts" value={stats.transcripts || 0} />
        <StatRibbon label="Faces" value={stats.faces || 0} />
        <StatRibbon label="Duplicates" value={stats.duplicate_groups || 0} icon={Copy} />
      </div>

      <div className="mb-10 journal-card p-6">
        <h2 className="mb-4 font-serif text-xl font-semibold text-ink">Indexing</h2>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => startIngest(false)}
            disabled={ingesting}
            className="btn-primary"
          >
            <RefreshCw size={16} className={ingesting ? 'animate-spin' : ''} />
            Incremental Index
          </button>
          <button
            type="button"
            onClick={() => startIngest(true)}
            disabled={ingesting}
            className="btn-secondary"
          >
            Full Re-index
          </button>
          <button type="button" onClick={toggleWatch} className="btn-secondary">
            {watching ? <Square size={16} /> : <Eye size={16} />}
            {watching ? 'Stop Watcher' : 'Start Watcher'}
          </button>
        </div>

        {progress && (
          <div className="mt-4 rounded-xl bg-paper p-4 text-sm">
            <div className="font-medium text-ink">
              {progress.stage}: {progress.completed}/{progress.total}
            </div>
            {progress.message && (
              <div className="mt-1 text-ink-muted">{progress.message}</div>
            )}
            {progress.total > 0 && (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-border">
                <div
                  className="h-full bg-terracotta transition-all"
                  style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-4 font-serif text-xl font-semibold text-ink">Duplicate Groups</h2>
        {dupsLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <LoadingSkeleton className="aspect-video" count={4} />
          </div>
        ) : (duplicates || []).length === 0 ? (
          <p className="text-sm text-ink-muted">No duplicate groups found.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {(duplicates || []).map((group) => (
              <DuplicateGroupCard
                key={group.id}
                group={group}
                onReview={reviewDuplicates}
              />
            ))}
          </div>
        )}
      </div>

      <MediaLightbox
        mediaId={lightboxId}
        onClose={() => { setLightboxId(null); setDupGroup(null) }}
        onSelectMedia={setLightboxId}
      />
    </motion.div>
  )
}
