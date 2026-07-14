import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import PageHeader from '../components/layout/PageHeader'
import YearTabBar from '../components/diary/YearTabBar'
import JournalEntry from '../components/diary/JournalEntry'
import EventStoryCard from '../components/diary/EventStoryCard'
import MasonryGrid from '../components/media/MasonryGrid'
import MediaLightbox from '../components/media/MediaLightbox'
import LoadingSkeleton from '../components/ui/LoadingSkeleton'
import StatRibbon from '../components/ui/StatRibbon'
import { Layers, Image as ImageIcon, Video, Clock } from 'lucide-react'
import { useTimeline, useAnalytics, fetchEventMedia } from '../hooks/useApi'

export default function TimelinePage() {
  const { year: yearParam } = useParams()
  const { data: analytics } = useAnalytics()
  const years = (analytics?.by_year || []).map((y) => y.year).sort((a, b) => b - a)
  const defaultYear = years[0] || new Date().getFullYear()
  const [selectedYear, setSelectedYear] = useState(
    yearParam ? parseInt(yearParam, 10) : defaultYear
  )
  const [lightboxId, setLightboxId] = useState(null)

  const { data, isLoading } = useTimeline(selectedYear)

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <PageHeader
        title="Timeline"
        subtitle="Your life story told through events, highlights, and loose memories."
      />

      <YearTabBar years={years} selected={selectedYear} onSelect={setSelectedYear} />

      {isLoading ? (
        <div className="mt-8 space-y-4">
          <LoadingSkeleton className="h-32 w-full" />
          <LoadingSkeleton className="h-48 w-full" />
        </div>
      ) : data ? (
        <div className="mt-8 space-y-8">
          <div className="grid gap-4 sm:grid-cols-4">
            <StatRibbon label="Total" value={data.stats.total} icon={Layers} />
            <StatRibbon label="Photos" value={data.stats.images} icon={ImageIcon} />
            <StatRibbon label="Videos" value={data.stats.videos} icon={Video} />
            <StatRibbon label="Events" value={data.stats.events} icon={Clock} />
          </div>

          {data.recap && (
            <JournalEntry>
              <div className="mb-2 font-serif text-lg font-semibold text-terracotta">
                {selectedYear} in Review
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{data.recap}</p>
            </JournalEntry>
          )}

          {data.highlights?.length > 0 && (
            <div>
              <h2 className="mb-4 font-serif text-xl font-semibold text-ink">Highlights</h2>
              <MasonryGrid
                items={data.highlights}
                onSelect={(item) => setLightboxId(item.id)}
                compact
              />
            </div>
          )}

          {data.events?.length > 0 && (
            <div>
              <h2 className="mb-4 font-serif text-xl font-semibold text-ink">Events</h2>
              <div className="space-y-4">
                {data.events.map((event) => (
                  <EventStoryCard
                    key={event.id}
                    event={event}
                    onExpand={(id) => fetchEventMedia(id)}
                    onSelectMedia={setLightboxId}
                  />
                ))}
              </div>
            </div>
          )}

          {data.ungrouped_media?.length > 0 && (
            <div>
              <h2 className="mb-4 font-serif text-xl font-semibold text-ink">Loose Pages</h2>
              <p className="mb-4 text-sm text-ink-muted">
                Memories not grouped into events — like pages tucked between journal entries.
              </p>
              <MasonryGrid
                items={data.ungrouped_media}
                onSelect={(item) => setLightboxId(item.id)}
              />
            </div>
          )}
        </div>
      ) : null}

      <MediaLightbox
        mediaId={lightboxId}
        onClose={() => setLightboxId(null)}
        onSelectMedia={setLightboxId}
      />
    </motion.div>
  )
}
