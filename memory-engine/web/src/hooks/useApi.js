import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: () => api('/api/status'),
  })
}

export function useAnalytics() {
  return useQuery({
    queryKey: ['analytics'],
    queryFn: () => api('/api/analytics'),
  })
}

export function useOnThisDay(month, day) {
  return useQuery({
    queryKey: ['on-this-day', month, day],
    queryFn: () => api(`/api/on-this-day?month=${month}&day=${day}`),
  })
}

export function usePeople(includeUnknown = false) {
  return useQuery({
    queryKey: ['people', includeUnknown],
    queryFn: () =>
      api(`/api/people?include_unknown=${includeUnknown}&min_photos=1`),
  })
}

export function usePersonMedia(personId) {
  return useQuery({
    queryKey: ['person-media', personId],
    queryFn: () => api(`/api/people/${personId}/media?limit=120`),
    enabled: !!personId,
  })
}

export function usePersonTimeline(personId) {
  return useQuery({
    queryKey: ['person-timeline', personId],
    queryFn: () => api(`/api/people/${personId}/timeline`),
    enabled: !!personId,
  })
}

export function useCooccurrence(personId) {
  return useQuery({
    queryKey: ['cooccurrence', personId],
    queryFn: () => api(`/api/people/cooccurrence?person_id=${personId}`),
    enabled: !!personId,
  })
}

export function usePlaces() {
  return useQuery({
    queryKey: ['places'],
    queryFn: () => api('/api/places'),
  })
}

export function useTrips() {
  return useQuery({
    queryKey: ['trips'],
    queryFn: () => api('/api/trips'),
  })
}

export function useTrip(tripId) {
  return useQuery({
    queryKey: ['trip', tripId],
    queryFn: () => api(`/api/trips/${tripId}`),
    enabled: !!tripId,
  })
}

export function useTimeline(year) {
  return useQuery({
    queryKey: ['timeline', year],
    queryFn: () => api(`/api/timeline/${year}`),
    enabled: !!year,
  })
}

export function useSceneAlbums() {
  return useQuery({
    queryKey: ['scene-albums'],
    queryFn: () => api('/api/scene-albums'),
  })
}

export function useWardrobe() {
  return useQuery({
    queryKey: ['wardrobe'],
    queryFn: () => api('/api/wardrobe?limit=200'),
  })
}

export function useDuplicates() {
  return useQuery({
    queryKey: ['duplicates'],
    queryFn: () => api('/api/duplicates'),
  })
}

export function useUpdatePerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }) =>
      api(`/api/people/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['people'] })
    },
  })
}

export async function searchMedia(query, limit = 48) {
  return api('/api/search', {
    method: 'POST',
    body: JSON.stringify({ query, limit }),
  })
}

export async function chatAsk(question) {
  return api('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ question }),
  })
}

export async function searchTranscripts(q) {
  return api(`/api/transcripts/search?q=${encodeURIComponent(q)}`)
}

export async function fetchEventMedia(eventId) {
  return api(`/api/events/${eventId}/media?limit=120`)
}

export async function fetchPlaceMedia(placeId) {
  return api(`/api/places/${placeId}/media?limit=120`)
}
