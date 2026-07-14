import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatShortDate } from '../../lib/format'
import MasonryGrid from '../media/MasonryGrid'

export default function EventStoryCard({ event, onSelectMedia, onExpand }) {
  const [expanded, setExpanded] = useState(false)
  const [media, setMedia] = useState([])
  const [loading, setLoading] = useState(false)

  async function toggle() {
    if (!expanded && !media.length) {
      setLoading(true)
      try {
        const items = await onExpand?.(event.id)
        setMedia(items || [])
      } finally {
        setLoading(false)
      }
    }
    setExpanded(!expanded)
  }

  return (
    <div className="journal-card overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-start justify-between gap-4 p-5 text-left"
      >
        <div>
          <div className="font-serif text-lg font-semibold text-ink">
            {event.name || event.summary || 'Memory event'}
          </div>
          <div className="mt-1 text-sm text-ink-muted">
            {formatShortDate(event.start_at)}
            {event.media_count > 0 && ` · ${event.media_count} memories`}
          </div>
          {event.summary && (
            <p className="mt-2 text-sm text-ink-muted line-clamp-2">{event.summary}</p>
          )}
        </div>
        {expanded ? (
          <ChevronUp size={20} className="shrink-0 text-ink-muted" />
        ) : (
          <ChevronDown size={20} className="shrink-0 text-ink-muted" />
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border p-4"
          >
            {loading ? (
              <div className="py-8 text-center text-sm text-ink-muted">Loading memories...</div>
            ) : (
              <MasonryGrid items={media} onSelect={(item) => onSelectMedia?.(item.id)} compact />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
