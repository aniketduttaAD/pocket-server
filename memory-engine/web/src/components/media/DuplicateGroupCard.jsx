import { mediaUrl } from '../../api'

export default function DuplicateGroupCard({ group, onReview }) {
  const rep = group.representative

  return (
    <button
      type="button"
      onClick={() => onReview?.(group)}
      className="journal-card overflow-hidden text-left transition hover:shadow-journal"
    >
      <div className="relative aspect-video overflow-hidden bg-paper">
        {rep ? (
          <img
            src={mediaUrl(rep.id)}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-ink-muted">No preview</div>
        )}
      </div>
      <div className="p-3">
        <div className="font-serif text-sm font-semibold text-ink">
          {group.member_count} similar photos
        </div>
        <div className="text-xs text-ink-muted">Tap to review duplicates</div>
      </div>
    </button>
  )
}
