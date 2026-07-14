import { Link } from 'react-router-dom'

export default function CooccurrenceList({ people = [] }) {
  if (!people.length) return null

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-ink-muted">
        Often appears with
      </h3>
      <div className="flex flex-wrap gap-2">
        {people.map((p) => (
          <Link
            key={p.id}
            to={`/people/${p.id}`}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-ink transition hover:border-terracotta hover:text-terracotta"
          >
            {p.name} <span className="text-ink-muted">({p.count})</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
