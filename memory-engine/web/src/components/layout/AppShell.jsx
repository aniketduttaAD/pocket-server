import { NavLink } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
import { NAV_ITEMS } from '../../lib/constants'
import { cn } from '../../lib/cn'
import BottomNav from './BottomNav'

export default function AppShell({ children }) {
  return (
    <div className="flex min-h-screen bg-paper">
      <aside className="sticky top-0 hidden h-screen w-60 flex-col border-r border-border bg-card/80 p-4 lg:flex">
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="rounded-xl bg-terracotta/10 p-2.5 text-terracotta">
            <BookOpen size={22} />
          </div>
          <div>
            <div className="font-serif text-lg font-semibold text-ink">Memory Diary</div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-ink-muted">
              Your digital journal
            </div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                  isActive
                    ? 'bg-terracotta/10 text-terracotta'
                    : 'text-ink-muted hover:bg-paper hover:text-ink'
                )
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-border pt-4 text-[10px] text-ink-muted">
          Memory Diary v1.0
        </div>
      </aside>

      <main className="flex-1 pb-20 lg:pb-0">
        <div className="margin-line min-h-screen">
          <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">{children}</div>
        </div>
      </main>

      <BottomNav />
    </div>
  )
}
