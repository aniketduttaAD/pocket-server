import { mediaUrl } from '../../api'

export default function SceneAlbumCard({ tag, count, coverId, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="journal-card group overflow-hidden text-left transition hover:shadow-journal"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-paper">
        {coverId ? (
          <img
            src={mediaUrl(coverId)}
            alt={tag}
            className="h-full w-full object-cover transition group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center font-serif text-ink-muted">
            {tag}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink/60 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <div className="font-serif text-lg font-semibold capitalize text-white">{tag}</div>
          <div className="text-xs text-white/80">{count} memories</div>
        </div>
      </div>
    </button>
  )
}
