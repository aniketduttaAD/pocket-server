import { NavLink } from 'react-router-dom'
import { NAV_ITEMS } from '../../lib/constants'
import { cn } from '../../lib/cn'

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-sm lg:hidden">
      <div className="flex items-center gap-1 overflow-x-auto px-2 py-2">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex shrink-0 flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-[10px] font-medium transition',
                isActive ? 'text-terracotta' : 'text-ink-muted'
              )
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
