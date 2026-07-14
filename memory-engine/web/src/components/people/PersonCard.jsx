import { mediaUrl } from '../../api'
import { cn } from '../../lib/cn'

export default function PersonCard({ person, onClick, selected }) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(person)}
      className={cn(
        'journal-card flex flex-col items-center gap-3 p-4 text-center transition hover:shadow-journal',
        selected && 'ring-2 ring-terracotta'
      )}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-terracotta/10 font-serif text-2xl font-semibold text-terracotta">
        {(person.display_name || person.name || '?')[0].toUpperCase()}
      </div>
      <div>
        <div className="font-serif text-sm font-semibold text-ink">
          {person.display_name || person.name}
        </div>
        <div className="text-xs text-ink-muted">{person.photo_count} photos</div>
      </div>
    </button>
  )
}
