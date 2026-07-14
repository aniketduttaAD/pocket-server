import { useState, useRef } from 'react'
import { Send, Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/layout/PageHeader'
import ChatBubble from '../components/ai/ChatBubble'
import AIChip from '../components/ai/AIChip'
import MediaLightbox from '../components/media/MediaLightbox'
import { CHAT_PROMPTS } from '../lib/constants'
import { chatAsk } from '../hooks/useApi'

export default function AskPage() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [lightboxId, setLightboxId] = useState(null)
  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  async function sendMessage(text) {
    if (!text.trim() || loading) return
    const userMsg = { role: 'user', text: text.trim() }
    setMessages((m) => [...m, userMsg])
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setLoading(true)

    try {
      const data = await chatAsk(userMsg.text)
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: data.answer, media: data.media || [] },
      ])
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: 'Sorry, I could not answer. The local model may still be downloading — run: python -m memory_engine download-llm',
        },
      ])
    } finally {
      setLoading(false)
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex h-[calc(100vh-8rem)] flex-col">
      <PageHeader
        title="Ask Your Diary"
        subtitle="Chat with your memories — powered by built-in local AI (no Ollama needed)."
        action={<AIChip>Local Qwen2.5 + CLIP search</AIChip>}
      />

      <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-polaroid">
        <div className="flex-1 space-y-4 overflow-y-auto p-4 lg:p-6">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Sparkles size={40} className="mb-4 text-sage" />
              <h3 className="font-serif text-xl font-semibold text-ink">
                What would you like to remember?
              </h3>
              <p className="mt-2 max-w-md text-sm text-ink-muted">
                Ask about people, places, dates, or themes. Your diary searches photos, faces,
                locations, and video transcripts to answer.
              </p>
              <div className="mt-8 grid w-full max-w-lg gap-4 sm:grid-cols-2">
                {Object.entries(CHAT_PROMPTS).map(([category, prompts]) => (
                  <div key={category} className="text-left">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                      {category}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {prompts.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => sendMessage(p)}
                          className="rounded-lg border border-border bg-paper px-3 py-2 text-left text-xs text-ink transition hover:border-terracotta hover:text-terracotta"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <ChatBubble
                  key={i}
                  role={msg.role}
                  text={msg.text}
                  media={msg.media}
                  onSelectMedia={setLightboxId}
                />
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-ink-muted">
                    <span className="animate-pulse">Thinking through your memories...</span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        <div className="border-t border-border p-4">
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = `${e.target.scrollHeight}px`
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your memories..."
              rows={1}
              className="input-journal max-h-32 min-h-[44px] flex-1 resize-none"
            />
            <button
              type="button"
              onClick={() => sendMessage(input)}
              disabled={loading || !input.trim()}
              className="btn-primary shrink-0"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>

      <MediaLightbox
        mediaId={lightboxId}
        onClose={() => setLightboxId(null)}
        onSelectMedia={setLightboxId}
      />
    </motion.div>
  )
}
