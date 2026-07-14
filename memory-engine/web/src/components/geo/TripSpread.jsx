import { formatShortDate } from '../../lib/format'
import MasonryGrid from '../media/MasonryGrid'

export default function TripSpread({ trip, media = [], onSelectMedia }) {
  return (
    <div className="journal-card overflow-hidden">
      <div className="border-b border-border bg-paper/50 p-6">
        <div className="font-serif text-2xl font-semibold text-ink">
          {trip.name || 'Journey'}
        </div>
        <div className="mt-1 text-sm text-ink-muted">
          {formatShortDate(trip.start_at)}
          {trip.end_at && trip.end_at !== trip.start_at && ` — ${formatShortDate(trip.end_at)}`}
          {trip.media_count > 0 && ` · ${trip.media_count} memories`}
        </div>
        {trip.place && (
          <div className="mt-2 text-sm text-terracotta">
            {trip.place.geocode_name || trip.place.name}
          </div>
        )}
      </div>
      {media.length > 0 && (
        <div className="p-4">
          <MasonryGrid items={media} onSelect={(item) => onSelectMedia?.(item.id)} compact />
        </div>
      )}
    </div>
  )
}
