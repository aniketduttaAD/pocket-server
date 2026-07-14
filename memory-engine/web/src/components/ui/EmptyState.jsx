import { BookOpen } from 'lucide-react'

export default function EmptyState({ title, description, icon: Icon = BookOpen }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-8 py-16 text-center">
      <div className="mb-4 rounded-full bg-terracotta/10 p-4 text-terracotta">
        <Icon size={32} />
      </div>
      <h3 className="font-serif text-lg font-semibold text-ink">{title}</h3>
      {description && (
        <p className="mt-2 max-w-sm text-sm text-ink-muted">{description}</p>
      )}
    </div>
  )
}
