import { useState } from 'react'
import { Check, Pencil } from 'lucide-react'

export default function FaceLabeler({ person, onSave }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(person.display_name || person.name || '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave(person.id, name.trim())
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="journal-card flex items-center gap-4 p-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sage/10 font-serif text-lg text-sage">
        ?
      </div>
      <div className="flex-1">
        {editing ? (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-journal"
            placeholder="Enter name..."
            autoFocus
          />
        ) : (
          <div className="font-serif text-sm font-semibold text-ink">{person.name}</div>
        )}
        <div className="text-xs text-ink-muted">{person.photo_count} photos</div>
      </div>
      {editing ? (
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn-primary !px-3 !py-2"
        >
          <Check size={16} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="btn-secondary !px-3 !py-2"
        >
          <Pencil size={16} />
        </button>
      )}
    </div>
  )
}
