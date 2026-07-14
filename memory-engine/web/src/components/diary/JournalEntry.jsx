export default function JournalEntry({ children, className = '' }) {
  return (
    <div
      className={`rounded-2xl border border-border bg-card p-6 font-serif text-ink leading-relaxed shadow-polaroid ${className}`}
    >
      {children}
    </div>
  )
}
