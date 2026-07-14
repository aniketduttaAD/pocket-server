import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

export default function JourneyMap({ places = [], onSelectPlace, height = '400px' }) {
  const validPlaces = places.filter((p) => p.latitude && p.longitude)
  const center =
    validPlaces.length > 0
      ? [validPlaces[0].latitude, validPlaces[0].longitude]
      : [20.5937, 78.9629]

  return (
    <div className="overflow-hidden rounded-2xl border border-border shadow-polaroid" style={{ height }}>
      <MapContainer center={center} zoom={validPlaces.length > 1 ? 5 : 10} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {validPlaces.map((place) => (
          <Marker
            key={place.id}
            position={[place.latitude, place.longitude]}
            eventHandlers={{ click: () => onSelectPlace?.(place) }}
          >
            <Popup>
              <div className="text-sm">
                <strong>{place.geocode_name || place.name || 'Place'}</strong>
                <br />
                {place.media_count} memories
                {place.is_home ? ' · Home' : ''}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
