import { motion } from 'framer-motion'
import PageHeader from '../components/layout/PageHeader'
import StatRibbon from '../components/ui/StatRibbon'
import LoadingSkeleton from '../components/ui/LoadingSkeleton'
import { Camera, Users, MapPin, Video, Image as ImageIcon } from 'lucide-react'
import { useAnalytics, useStatus } from '../hooks/useApi'

function YearBarChart({ data = [] }) {
  const max = Math.max(...data.map((d) => d.count), 1)
  return (
    <div className="journal-card p-6">
      <h3 className="mb-4 font-serif text-lg font-semibold text-ink">Photos per Year</h3>
      <div className="flex items-end gap-2" style={{ height: 160 }}>
        {data.map((d) => (
          <div key={d.year} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t-lg bg-terracotta/80 transition-all"
              style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? 4 : 0 }}
              title={`${d.year}: ${d.count}`}
            />
            <span className="text-[10px] text-ink-muted">{String(d.year).slice(-2)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RankedList({ title, items = [], icon: Icon }) {
  return (
    <div className="journal-card p-6">
      <h3 className="mb-4 flex items-center gap-2 font-serif text-lg font-semibold text-ink">
        {Icon && <Icon size={18} className="text-terracotta" />}
        {title}
      </h3>
      <div className="space-y-2">
        {items.slice(0, 10).map((item, i) => (
          <div key={i} className="flex items-center justify-between text-sm">
            <span className="text-ink">{item.name?.split(',')[0] || item.name}</span>
            <span className="font-medium text-terracotta">
              {item.photo_count || item.media_count || item.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function InsightsPage() {
  const { data: analytics, isLoading: analyticsLoading } = useAnalytics()
  const { data: status, isLoading: statusLoading } = useStatus()

  const isLoading = analyticsLoading || statusLoading
  const stats = status?.stats || {}

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <PageHeader
        title="Insights"
        subtitle="Life statistics from your memory library — people, places, years, and media breakdown."
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <LoadingSkeleton className="h-24" count={4} />
        </div>
      ) : (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatRibbon label="Total Media" value={stats.media || 0} icon={Camera} />
            <StatRibbon label="Photos" value={stats.images || 0} icon={ImageIcon} />
            <StatRibbon label="Videos" value={stats.videos || 0} icon={Video} />
            <StatRibbon label="People" value={stats.people || 0} icon={Users} />
          </div>

          <div className="mb-8 grid gap-6 lg:grid-cols-2">
            <YearBarChart data={analytics?.by_year || []} />
            <RankedList title="Top People" items={analytics?.top_people || []} icon={Users} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <RankedList title="Top Places" items={analytics?.top_places || []} icon={MapPin} />
            <div className="journal-card p-6">
              <h3 className="mb-4 font-serif text-lg font-semibold text-ink">Library Breakdown</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-ink-muted">GPS-tagged photos</span>
                  <span className="font-medium text-ink">{stats.gps_photos || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-muted">Face detections</span>
                  <span className="font-medium text-ink">{stats.faces || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-muted">Timeline events</span>
                  <span className="font-medium text-ink">{stats.events || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-muted">CLIP embeddings</span>
                  <span className="font-medium text-ink">{stats.embeddings || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-muted">Video transcripts</span>
                  <span className="font-medium text-ink">{stats.transcripts || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-muted">Duplicate groups</span>
                  <span className="font-medium text-ink">{stats.duplicate_groups || 0}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </motion.div>
  )
}
