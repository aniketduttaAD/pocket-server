import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/layout/PageHeader'
import CooccurrenceList from '../components/people/CooccurrenceList'
import MasonryGrid from '../components/media/MasonryGrid'
import MediaLightbox from '../components/media/MediaLightbox'
import LoadingSkeleton from '../components/ui/LoadingSkeleton'
import { usePeople, usePersonTimeline, useCooccurrence } from '../hooks/useApi'

export default function PersonDetailPage() {
  const { id } = useParams()
  const personId = parseInt(id, 10)
  const [lightboxId, setLightboxId] = useState(null)

  const { data: people } = usePeople(true)
  const person = (people || []).find((p) => p.id === personId)
  const { data: timeline, isLoading } = usePersonTimeline(personId)
  const { data: cooccurrence } = useCooccurrence(personId)

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <Link
        to="/people"
        className="mb-4 inline-flex items-center gap-2 text-sm text-ink-muted hover:text-terracotta"
      >
        <ArrowLeft size={16} />
        Back to People
      </Link>

      <PageHeader
        title={person?.display_name || person?.name || 'Person'}
        subtitle={`${person?.photo_count || 0} photos across your memories`}
      />

      <div className="mb-8">
        <CooccurrenceList people={cooccurrence || []} />
      </div>

      {isLoading ? (
        <LoadingSkeleton className="h-48 w-full" />
      ) : timeline?.by_year ? (
        <div className="space-y-8">
          {Object.entries(timeline.by_year)
            .sort(([a], [b]) => Number(b) - Number(a))
            .map(([year, items]) => (
              <div key={year}>
                <h2 className="mb-4 font-serif text-xl font-semibold text-terracotta">{year}</h2>
                <MasonryGrid
                  items={items}
                  onSelect={(item) => setLightboxId(item.id)}
                />
              </div>
            ))}
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
