import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { UserX } from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import PersonCard from '../components/people/PersonCard'
import FaceLabeler from '../components/people/FaceLabeler'
import MasonryGrid from '../components/media/MasonryGrid'
import MediaLightbox from '../components/media/MediaLightbox'
import LoadingSkeleton from '../components/ui/LoadingSkeleton'
import EmptyState from '../components/ui/EmptyState'
import { usePeople, useUpdatePerson } from '../hooks/useApi'

export default function PeoplePage() {
  const [tab, setTab] = useState('known')
  const [lightboxId, setLightboxId] = useState(null)

  const { data: knownPeople, isLoading: knownLoading } = usePeople(false)
  const { data: unknownPeople, isLoading: unknownLoading } = usePeople(true)
  const updatePerson = useUpdatePerson()

  const unknown = (unknownPeople || []).filter((p) => p.name?.startsWith('Unknown Person'))
  const known = knownPeople || []

  async function handleLabel(id, name) {
    await updatePerson.mutateAsync({ id, name })
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <PageHeader
        title="People"
        subtitle="Browse faces, label unknown clusters, and explore who appears in your memories."
      />

      <div className="mb-6 flex gap-2">
        <button
          type="button"
          onClick={() => { setTab('known') }}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
            tab === 'known' ? 'bg-terracotta text-white' : 'border border-border bg-card text-ink-muted'
          }`}
        >
          Known ({known.length})
        </button>
        <button
          type="button"
          onClick={() => { setTab('unknown') }}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
            tab === 'unknown' ? 'bg-terracotta text-white' : 'border border-border bg-card text-ink-muted'
          }`}
        >
          <UserX size={16} />
          Unknown ({unknown.length})
        </button>
      </div>

      {tab === 'known' && (
        <>
          {knownLoading ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
              <LoadingSkeleton className="h-32" count={6} />
            </div>
          ) : known.length === 0 ? (
            <EmptyState title="No people found" description="People are detected from face clusters and photo keywords." />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
              {known.map((person) => (
                <Link key={person.id} to={`/people/${person.id}`}>
                  <PersonCard person={person} />
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'unknown' && (
        <>
          {unknownLoading ? (
            <LoadingSkeleton className="h-20 w-full" count={3} />
          ) : unknown.length === 0 ? (
            <EmptyState title="All faces labeled" description="No unknown face clusters remain." />
          ) : (
            <div className="space-y-3">
              {unknown.map((person) => (
                <FaceLabeler key={person.id} person={person} onSave={handleLabel} />
              ))}
            </div>
          )}
        </>
      )}

      <MediaLightbox
        mediaId={lightboxId}
        onClose={() => setLightboxId(null)}
        onSelectMedia={setLightboxId}
      />
    </motion.div>
  )
}
