import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Calendar,
  MapPin,
  Tag,
  FileText,
  Copy,
  Users,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { api, mediaUrl } from '../../api'
import { formatDate, formatBytes, parseSceneTags } from '../../lib/format'
import AIChip from '../ai/AIChip'
import MasonryGrid from './MasonryGrid'
import LoadingSkeleton from '../ui/LoadingSkeleton'

const TABS = [
  { id: 'info', label: 'Info', icon: Calendar },
  { id: 'location', label: 'Location', icon: MapPin },
  { id: 'tags', label: 'AI Tags', icon: Tag },
  { id: 'transcript', label: 'Transcript', icon: FileText },
  { id: 'duplicates', label: 'Duplicates', icon: Copy },
  { id: 'similar', label: 'Similar', icon: Sparkles },
]

export default function MediaLightbox({ mediaId, onClose, onSelectMedia }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [activeTab, setActiveTab] = useState('info')
  const [similar, setSimilar] = useState([])
  const [faces, setFaces] = useState([])
  const videoRef = useRef(null)

  useEffect(() => {
    if (!mediaId) return
    setLoading(true)
    setActiveTab('info')
    Promise.all([
      api(`/api/media/${mediaId}`),
      api(`/api/media/${mediaId}/faces`).catch(() => ({ faces: [] })),
    ])
      .then(([mediaData, faceData]) => {
        setData(mediaData)
        setFaces(faceData.faces || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [mediaId])

  useEffect(() => {
    if (mediaId && activeTab === 'similar') {
      api(`/api/media/${mediaId}/similar?limit=24`)
        .then((res) => setSimilar(res.results || []))
        .catch(() => setSimilar([]))
    }
  }, [mediaId, activeTab])

  if (!mediaId) return null

  const media = data?.media
  const people = data?.people || []
  const places = data?.places || []
  const transcript = data?.transcript
  const duplicates = data?.duplicates || []
  const sceneTags = parseSceneTags(media?.scene_tags)
  const wardrobeTags = parseSceneTags(media?.wardrobe_tags)

  const tabs = TABS.filter((t) => {
    if (t.id === 'transcript') return !!transcript
    if (t.id === 'duplicates') return duplicates.length > 0
    return true
  })

  function seekTranscript(seconds) {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds
      videoRef.current.play()
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-card shadow-journal lg:flex-row"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 z-10 rounded-full bg-card/90 p-2 text-ink-muted shadow hover:text-ink"
            aria-label="Close"
          >
            <X size={20} />
          </button>

          <div className="relative flex-1 bg-paper p-4 lg:max-w-[55%]">
            {loading ? (
              <LoadingSkeleton className="aspect-square w-full" />
            ) : media?.media_type === 'video' ? (
              <div className="relative">
                <video
                  ref={videoRef}
                  src={mediaUrl(mediaId)}
                  controls
                  className="max-h-[60vh] w-full rounded-xl object-contain"
                />
                {faces.map((f, i) => (
                  <div
                    key={i}
                    className="pointer-events-none absolute border-2 border-sage"
                    style={{
                      left: `${f.bbox_x * 100}%`,
                      top: `${f.bbox_y * 100}%`,
                      width: `${f.bbox_w * 100}%`,
                      height: `${f.bbox_h * 100}%`,
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="relative">
                <img
                  src={mediaUrl(mediaId)}
                  alt=""
                  className="max-h-[60vh] w-full rounded-xl object-contain"
                />
                {faces.map((f, i) => (
                  <div
                    key={i}
                    className="pointer-events-none absolute border-2 border-sage"
                    style={{
                      left: `${f.bbox_x * 100}%`,
                      top: `${f.bbox_y * 100}%`,
                      width: `${f.bbox_w * 100}%`,
                      height: `${f.bbox_h * 100}%`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex w-full flex-col border-t border-border lg:w-[45%] lg:border-l lg:border-t-0">
            <div className="flex gap-1 overflow-x-auto border-b border-border p-2">
              {tabs.map((tab) => {
                const Icon = tab.icon
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition ${
                      activeTab === tab.id
                        ? 'bg-terracotta/10 text-terracotta'
                        : 'text-ink-muted hover:bg-paper'
                    }`}
                  >
                    <Icon size={14} />
                    {tab.label}
                  </button>
                )
              })}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="space-y-3">
                  <LoadingSkeleton className="h-4 w-3/4" />
                  <LoadingSkeleton className="h-4 w-1/2" />
                </div>
              ) : (
                <>
                  {activeTab === 'info' && (
                    <div className="space-y-4 text-sm">
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wider text-ink-muted">
                          Date
                        </div>
                        <div className="font-serif text-ink">{formatDate(media?.taken_at)}</div>
                      </div>
                      {people.length > 0 && (
                        <div>
                          <div className="mb-1 flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-ink-muted">
                            <Users size={12} /> People
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {people.map((p) => (
                              <span
                                key={p.id}
                                className="rounded-full bg-paper px-2.5 py-1 text-xs text-ink"
                              >
                                {p.display_name || p.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wider text-ink-muted">
                          File
                        </div>
                        <div className="text-ink-muted">{media?.rel_path}</div>
                        <div className="text-xs text-ink-muted">
                          {formatBytes(media?.file_size)} · {media?.width}×{media?.height}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'location' && (
                    <div className="space-y-3 text-sm">
                      {media?.latitude ? (
                        <>
                          <div className="text-ink">
                            {media.latitude.toFixed(5)}, {media.longitude.toFixed(5)}
                          </div>
                          {places.map((pl) => (
                            <div key={pl.id} className="rounded-lg bg-paper p-3">
                              {pl.geocode_name || pl.name || 'Unknown place'}
                            </div>
                          ))}
                        </>
                      ) : (
                        <p className="text-ink-muted">No location data</p>
                      )}
                    </div>
                  )}

                  {activeTab === 'tags' && (
                    <div className="space-y-3">
                      {sceneTags.length > 0 && (
                        <div>
                          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-muted">
                            Scene
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {sceneTags.map((t) => (
                              <AIChip key={t}>{t}</AIChip>
                            ))}
                          </div>
                        </div>
                      )}
                      {wardrobeTags.length > 0 && (
                        <div>
                          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-muted">
                            Wardrobe
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {wardrobeTags.map((t) => (
                              <span
                                key={t}
                                className="rounded-full bg-terracotta/10 px-2.5 py-1 text-xs text-terracotta"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {!sceneTags.length && !wardrobeTags.length && (
                        <p className="text-sm text-ink-muted">No AI tags</p>
                      )}
                    </div>
                  )}

                  {activeTab === 'transcript' && transcript && (
                    <div className="space-y-3 text-sm">
                      <p className="text-ink leading-relaxed">{transcript.text}</p>
                      {transcript.segments && (
                        <div className="space-y-1">
                          {JSON.parse(transcript.segments).map((seg, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => seekTranscript(seg.start)}
                              className="block w-full rounded-lg bg-paper px-3 py-2 text-left text-xs text-ink-muted hover:bg-sage/10 hover:text-ink"
                            >
                              <span className="font-mono text-terracotta">
                                {Math.floor(seg.start / 60)}:
                                {String(Math.floor(seg.start % 60)).padStart(2, '0')}
                              </span>{' '}
                              {seg.text}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === 'duplicates' && (
                    <MasonryGrid
                      items={duplicates}
                      onSelect={(item) => onSelectMedia?.(item.id)}
                      compact
                    />
                  )}

                  {activeTab === 'similar' && (
                    <div>
                      <p className="mb-3 text-xs text-ink-muted">
                        <AIChip>CLIP semantic similarity</AIChip>
                      </p>
                      <MasonryGrid
                        items={similar}
                        onSelect={(item) => onSelectMedia?.(item.id)}
                        compact
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
