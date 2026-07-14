import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { motion } from 'framer-motion'
import TripSpread from '../components/geo/TripSpread'
import MediaLightbox from '../components/media/MediaLightbox'
import LoadingSkeleton from '../components/ui/LoadingSkeleton'
import { useTrip } from '../hooks/useApi'

export default function TripDetailPage() {
  const { id } = useParams()
  const [lightboxId, setLightboxId] = useState(null)
  const { data: trip, isLoading } = useTrip(parseInt(id, 10))

  if (isLoading) return <LoadingSkeleton className="h-64 w-full" />

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <Link
        to="/journeys"
        className="mb-4 inline-flex items-center gap-2 text-sm text-ink-muted hover:text-terracotta"
      >
        <ArrowLeft size={16} />
        Back to Journeys
      </Link>

      {trip && !trip.error && (
        <TripSpread
          trip={{ ...trip, place: trip.place }}
          media={trip.media || []}
          onSelectMedia={setLightboxId}
        />
      )}

      <MediaLightbox
        mediaId={lightboxId}
        onClose={() => setLightboxId(null)}
        onSelectMedia={setLightboxId}
      />
    </motion.div>
  )
}
