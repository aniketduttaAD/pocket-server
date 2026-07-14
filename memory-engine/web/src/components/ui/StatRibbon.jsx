import { cn } from '../../lib/cn'

export default function StatRibbon({ label, value, icon: Icon, className }) {
  return (
    <div className={cn('journal-card flex items-center gap-3 px-4 py-3', className)}>
      {Icon && (
        <div className="rounded-lg bg-terracotta/10 p-2 text-terracotta">
          <Icon size={18} />
        </div>
      )}
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-ink-muted">{label}</div>
        <div className="font-serif text-xl font-semibold text-ink">{value}</div>
      </div>
    </div>
  )
}
