import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Home, Plane } from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import JourneyMap from '../components/geo/JourneyMap'
import TripSpread from '../components/geo/TripSpread'
import MasonryGrid from '../components/media/MasonryGrid'
import MediaLightbox from '../components/media/MediaLightbox'
import StatRibbon from '../components/ui/StatRibbon'
import LoadingSkeleton from '../components/ui/LoadingSkeleton'
import { usePlaces, useTrips, fetchPlaceMedia } from '../hooks/useApi'

export default function JourneysPage() {
  const [selectedPlace, setSelectedPlace] = useState(null)
  const [placeMedia, setPlaceMedia] = useState([])
  const [lightboxId, setLightboxId] = useState(null)

  const { data: places, isLoading: placesLoading } = usePlaces()
  const { data: trips, isLoading: tripsLoading } = useTrips()

  const homePlaces = (places || []).filter((p) => p.is_home)
  const awayPlaces = (places || []).filter((p) => !p.is_home)

  async function selectPlace(place) {
    setSelectedPlace(place)
    const media = await fetchPlaceMedia(place.id)
    setPlaceMedia(media)
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <PageHeader
        title="Journeys"
        subtitle="Places you've been, trips detected from your photos, and your geographic memory map."
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <StatRibbon label="Home Places" value={homePlaces.length} icon={Home} />
        <StatRibbon label="Away Places" value={awayPlaces.length} icon={Plane} />
      </div>

      {placesLoading ? (
        <LoadingSkeleton className="h-[400px] w-full" />
      ) : (
        <div className="mb-10">
          <h2 className="mb-4 font-serif text-xl font-semibold text-ink">Map</h2>
          <JourneyMap places={places || []} onSelectPlace={selectPlace} />
        </div>
      )}

      {selectedPlace && (
        <div className="mb-10">
          <h2 className="mb-2 font-serif text-xl font-semibold text-ink">
            {selectedPlace.geocode_name || selectedPlace.name || 'Selected place'}
          </h2>
          <p className="mb-4 text-sm text-ink-muted">{selectedPlace.media_count} memories here</p>
          <MasonryGrid items={placeMedia} onSelect={(item) => setLightboxId(item.id)} />
        </div>
      )}

      <div>
        <h2 className="mb-4 font-serif text-xl font-semibold text-ink">Trips</h2>
        {tripsLoading ? (
          <LoadingSkeleton className="h-48 w-full" count={2} />
        ) : (trips || []).length === 0 ? (
          <p className="text-sm text-ink-muted">No trips detected yet.</p>
        ) : (
          <div className="space-y-6">
            {(trips || []).map((trip) => (
              <Link key={trip.id} to={`/journeys/${trip.id}`}>
                <TripSpread trip={trip} />
              </Link>
            ))}
          </div>
        )}
      </div>

      <MediaLightbox
        mediaId={lightboxId}
        onClose={() => setLightboxId(null)}
        onSelectMedia={setLightboxId}
      />
    </motion.div>
  )
}
