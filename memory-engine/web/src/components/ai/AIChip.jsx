import { Sparkles } from 'lucide-react'
import { cn } from '../../lib/cn'

export default function AIChip({ children, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-sage/10 px-2.5 py-1 text-xs font-medium text-sage',
        className
      )}
    >
      <Sparkles size={12} />
      {children}
    </span>
  )
}
