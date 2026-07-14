import { cn } from '../../lib/cn'

export default function LoadingSkeleton({ className, count = 1 }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'animate-shimmer rounded-xl bg-gradient-to-r from-border/40 via-border/20 to-border/40 bg-[length:200%_100%]',
            className
          )}
        />
      ))}
    </>
  )
}
