import { motion } from 'framer-motion'
import { Play, Video } from 'lucide-react'
import { mediaUrl } from '../../api'
import { formatShortDate } from '../../lib/format'
import { cn } from '../../lib/cn'

export default function PolaroidCard({
  item,
  onClick,
  className,
  showDate = true,
  rotation = 0,
}) {
  const isVideo = item.media_type === 'video'

  return (
    <motion.button
      type="button"
      onClick={() => onClick?.(item)}
      className={cn('group relative text-left', className)}
      whileHover={{ scale: 1.02, rotate: rotation + 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      style={{ rotate: `${rotation}deg` }}
    >
      <div className="journal-card overflow-hidden p-2 pb-3">
        <div className="absolute -left-1 -top-1 h-6 w-10 rotate-[-35deg] bg-tape/80 shadow-sm" />
        <div className="absolute -right-1 -top-1 h-6 w-10 rotate-[35deg] bg-tape/80 shadow-sm" />

        <div className="relative aspect-square overflow-hidden rounded-lg bg-paper">
          {isVideo ? (
            <video
              src={mediaUrl(item.id)}
              className="h-full w-full object-cover"
              muted
              preload="metadata"
            />
          ) : (
            <img
              src={mediaUrl(item.id)}
              alt=""
              className="h-full w-full object-cover transition group-hover:scale-105"
              loading="lazy"
            />
          )}
          {isVideo && (
            <div className="absolute inset-0 flex items-center justify-center bg-ink/20">
              <div className="rounded-full bg-card/90 p-2 text-ink">
                <Play size={16} fill="currentColor" />
              </div>
            </div>
          )}
        </div>

        {showDate && (
          <div className="mt-2 flex items-center justify-between px-1">
            <span className="font-serif text-xs text-ink-muted">
              {formatShortDate(item.taken_at)}
            </span>
            {isVideo && <Video size={12} className="text-ink-muted" />}
          </div>
        )}
      </div>
    </motion.button>
  )
}
