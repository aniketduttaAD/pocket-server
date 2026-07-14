export default function PageHeader({ title, subtitle, action, children }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-ink lg:text-4xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">{subtitle}</p>
        )}
      </div>
      {(action || children) && (
        <div className="flex shrink-0 items-center gap-2">{action || children}</div>
      )}
    </div>
  )
}
