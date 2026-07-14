import { motion } from 'framer-motion'
import MasonryGrid from '../media/MasonryGrid'

export default function ChatBubble({ role, text, media = [], onSelectMedia }) {
  const isUser = role === 'user'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-terracotta text-white'
            : 'border border-border bg-card font-serif text-ink shadow-polaroid'
        }`}
      >
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
        {!isUser && media.length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <MasonryGrid
              items={media.slice(0, 6)}
              onSelect={(item) => onSelectMedia?.(item.id)}
              compact
              columns={3}
            />
          </div>
        )}
      </div>
    </motion.div>
  )
}
