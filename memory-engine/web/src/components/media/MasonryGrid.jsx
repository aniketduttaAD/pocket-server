import PolaroidCard from './PolaroidCard'

export default function MasonryGrid({ items = [], onSelect, columns = 4, compact = false }) {
  if (!items.length) return null

  const cols = compact
    ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6'
    : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-' + Math.min(columns, 5)

  return (
    <div className={`grid gap-4 ${cols}`}>
      {items.map((item, i) => (
        <PolaroidCard
          key={item.id}
          item={item}
          onClick={onSelect}
          rotation={(i % 3) - 1}
          showDate={!compact}
        />
      ))}
    </div>
  )
}
