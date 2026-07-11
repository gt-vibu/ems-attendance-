// Reusable OpenStreetMap (Leaflet) location picker — free, no API key, no
// billing. Supports: draggable marker, click-to-place, live coordinates while
// dragging, a radius circle preview, "Use Current Location", zoom/pan, and an
// optional GPS accuracy readout.
//
// It is intentionally *controlled*: the parent owns lat/lng (and radius) and
// this component reports changes via onChange, so it drops into existing forms
// without changing any save logic or state shape.
//
// This module is meant to be lazy-loaded (React.lazy) so Leaflet stays out of
// the main bundle — see how it's imported in Dashboard/EmployeeAttendance.
import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// Leaflet's default marker images don't resolve under bundlers; wire them up
// from the package assets (Vite turns these into hashed URLs) so the pin shows.
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Neutral fallback view (India centroid) when no coordinates are set yet.
const DEFAULT_CENTER: [number, number] = [20.5937, 78.9629];
const DEFAULT_ZOOM = 5;
const FOCUS_ZOOM = 16;

export interface LocationPickerProps {
  lat: number | null;
  lng: number | null;
  radius?: number | null;
  accuracy?: number | null;
  onChange: (lat: number, lng: number, accuracy?: number) => void;
  height?: number;
  className?: string;
}

function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// Drives the map view imperatively: fixes sizing when mounted inside a
// tab/modal, re-centers with a zoom-in on explicit focus (current-location /
// first fix), and passively brings the marker back if it drifts out of view
// (e.g. coordinates typed into the form inputs).
function MapController({ lat, lng, focusNonce }: { lat: number | null; lng: number | null; focusNonce: number }) {
  const map = useMap();

  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 0);
    return () => clearTimeout(t);
  }, [map]);

  useEffect(() => {
    if (focusNonce > 0 && lat != null && lng != null) {
      map.setView([lat, lng], Math.max(map.getZoom(), FOCUS_ZOOM));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  useEffect(() => {
    if (lat == null || lng == null) return;
    const c = L.latLng(lat, lng);
    if (!map.getBounds().contains(c)) map.setView(c, map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  return null;
}

export default function LocationPicker({
  lat,
  lng,
  radius,
  accuracy,
  onChange,
  height = 300,
  className,
}: LocationPickerProps) {
  const hasPos = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
  const position: [number, number] = hasPos ? [lat as number, lng as number] : DEFAULT_CENTER;

  // Nonce starts at 1 when we already have a position so the map centers on it
  // at mount; bumped when the user asks for their current location.
  const [focusNonce, setFocusNonce] = useState(hasPos ? 1 : 0);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState('');
  // Live coordinates shown while a drag is in progress (marker position itself
  // stays controlled; we only commit on dragend to avoid fighting Leaflet).
  const [dragCoords, setDragCoords] = useState<{ lat: number; lng: number } | null>(null);

  const useCurrentLocation = () => {
    setGeoError('');
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported on this device.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        setFocusNonce((n) => n + 1);
        setLocating(false);
      },
      () => {
        setGeoError('Unable to get your location. Check browser/device permissions.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const shown = dragCoords || (hasPos ? { lat: lat as number, lng: lng as number } : null);

  return (
    <div className={className}>
      <div style={{ height }} className="rounded-xl overflow-hidden border border-slate-200 relative z-0">
        <MapContainer
          center={position}
          zoom={hasPos ? FOCUS_ZOOM : DEFAULT_ZOOM}
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          <ClickToPlace onPick={(la, ln) => onChange(la, ln)} />
          {hasPos && (
            <>
              <Marker
                position={position}
                draggable
                eventHandlers={{
                  drag(e) {
                    const p = (e.target as L.Marker).getLatLng();
                    setDragCoords({ lat: p.lat, lng: p.lng });
                  },
                  dragend(e) {
                    const p = (e.target as L.Marker).getLatLng();
                    setDragCoords(null);
                    onChange(p.lat, p.lng);
                  },
                }}
              />
              {radius && radius > 0 ? (
                <Circle
                  center={position}
                  radius={radius}
                  pathOptions={{ color: '#7B5CFA', fillColor: '#7B5CFA', fillOpacity: 0.12, weight: 1.5 }}
                />
              ) : null}
            </>
          )}
          <MapController lat={hasPos ? (lat as number) : null} lng={hasPos ? (lng as number) : null} focusNonce={focusNonce} />
        </MapContainer>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={locating}
          className="text-xs bg-white border border-slate-200 text-slate-700 font-semibold px-3 py-1.5 rounded-lg hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
        >
          {locating ? 'Locating…' : 'Use Current Location'}
        </button>
        <span className="text-[11px] font-mono text-slate-500">
          {shown ? (
            <>
              {shown.lat.toFixed(6)}, {shown.lng.toFixed(6)}
              {accuracy != null ? ` · ±${Math.round(accuracy)}m` : ''}
            </>
          ) : (
            'Click the map or use current location'
          )}
        </span>
      </div>
      {geoError ? <p className="mt-1 text-[11px] text-red-500">{geoError}</p> : null}
    </div>
  );
}
