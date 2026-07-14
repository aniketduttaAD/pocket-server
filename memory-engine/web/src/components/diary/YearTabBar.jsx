import { cn } from '../../lib/cn'

export default function YearTabBar({ years = [], selected, onSelect }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {years.map((year) => (
        <button
          key={year}
          type="button"
          onClick={() => onSelect(year)}
          className={cn(
            'shrink-0 rounded-xl px-4 py-2 font-serif text-sm font-medium transition',
            selected === year
              ? 'bg-terracotta text-white shadow-polaroid'
              : 'border border-border bg-card text-ink-muted hover:text-ink'
          )}
        >
          {year}
        </button>
      ))}
    </div>
  )
}
