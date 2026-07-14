import { useState } from 'react'
import { format } from 'date-fns'
import { Sparkles, Camera, MapPin, Calendar } from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/layout/PageHeader'
import JournalEntry from '../components/diary/JournalEntry'
import AIChip from '../components/ai/AIChip'
import StatRibbon from '../components/ui/StatRibbon'
import MasonryGrid from '../components/media/MasonryGrid'
import MediaLightbox from '../components/media/MediaLightbox'
import LoadingSkeleton from '../components/ui/LoadingSkeleton'
import EmptyState from '../components/ui/EmptyState'
import { useOnThisDay, useAnalytics, chatAsk } from '../hooks/useApi'

export default function TodayPage() {
  const today = new Date()
  const month = today.getMonth() + 1
  const day = today.getDate()
  const [lightboxId, setLightboxId] = useState(null)
  const [recap, setRecap] = useState(null)
  const [recapLoading, setRecapLoading] = useState(false)

  const { data: onThisDay, isLoading } = useOnThisDay(month, day)
  const { data: analytics } = useAnalytics()

  const dateLabel = format(today, 'MMMM d')
  const memories = onThisDay?.memories || []
  const byYear = onThisDay?.by_year || {}
  const currentYear = today.getFullYear()
  const thisYearCount = analytics?.by_year?.find((y) => y.year === currentYear)?.count || 0

  async function generateRecap() {
    setRecapLoading(true)
    try {
      const prompt = `What happened on ${dateLabel} across my years? Summarize the memories from this day.`
      const res = await chatAsk(prompt)
      setRecap(res.answer)
    } catch {
      setRecap('Could not generate recap. The local model may still be downloading.')
    } finally {
      setRecapLoading(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <PageHeader
        title={`Today — ${dateLabel}`}
        subtitle="Memories from this day across the years, your personal on-this-day journal."
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <StatRibbon label="On This Day" value={onThisDay?.total || 0} icon={Calendar} />
        <StatRibbon label={`${currentYear} Memories`} value={thisYearCount} icon={Camera} />
        <StatRibbon
          label="Top Place"
          value={analytics?.top_places?.[0]?.name?.split(',')[0] || '—'}
          icon={MapPin}
        />
      </div>

      <div className="mb-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-xl font-semibold text-ink">On This Day</h2>
          <AIChip>Across all years</AIChip>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <LoadingSkeleton className="aspect-square" count={4} />
          </div>
        ) : memories.length === 0 ? (
          <EmptyState
            title="No memories on this day"
            description={`Nothing captured on ${dateLabel} yet. Check back as your library grows.`}
          />
        ) : (
          <div className="space-y-8">
            {Object.entries(byYear).map(([year, items]) => (
              <div key={year}>
                <h3 className="mb-3 font-serif text-lg font-medium text-terracotta">{year}</h3>
                <MasonryGrid items={items} onSelect={(item) => setLightboxId(item.id)} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-xl font-semibold text-ink">AI Daily Recap</h2>
          {!recap && (
            <button
              type="button"
              onClick={generateRecap}
              disabled={recapLoading || !memories.length}
              className="btn-primary text-sm"
            >
              <Sparkles size={16} />
              {recapLoading ? 'Writing...' : 'Generate recap'}
            </button>
          )}
        </div>
        {recap ? (
          <JournalEntry>
            <p className="whitespace-pre-wrap">{recap}</p>
            <button
              type="button"
              onClick={() => setRecap(null)}
              className="mt-4 text-xs text-terracotta hover:underline"
            >
              Regenerate
            </button>
          </JournalEntry>
        ) : (
          <JournalEntry className="text-ink-muted italic">
            {memories.length
              ? 'Tap "Generate recap" for an AI-written summary of your on-this-day memories.'
              : 'Add memories to unlock AI daily recaps.'}
          </JournalEntry>
        )}
      </div>

      {memories.length > 0 && (
        <div>
          <h2 className="mb-4 font-serif text-xl font-semibold text-ink">Recent Highlights</h2>
          <MasonryGrid
            items={memories.slice(0, 12)}
            onSelect={(item) => setLightboxId(item.id)}
            compact
          />
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
