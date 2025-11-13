// src/SharkMap.jsx
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./SharkMap.css"; // 👈 new styling

// Fix default marker icon paths (Vite + Leaflet quirk)
const defaultIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

L.Marker.prototype.options.icon = defaultIcon;

const DATA_URL = `${import.meta.env.BASE_URL}data/luna_track.json`;

export default function SharkMap() {
  const [shark, setShark] = useState(null);
  const [track, setTrack] = useState([]);
  const [remoteSharks, setRemoteSharks] = useState([]);

  // Local Luna JSON
  useEffect(() => {
    fetch(DATA_URL)
      .then((res) => res.json())
      .then((data) => {
        setShark(data);
        setTrack(data.pings || []);
      })
      .catch((err) => console.error("Error fetching shark data:", err));
  }, []);

  // Remote sharks from your backend
  useEffect(() => {
    async function fetchRemoteSharks() {
      try {
        const resp = await fetch(
          "https://shark-backend-yz6s.onrender.com/api/sharks"
        );
        if (!resp.ok) {
          throw new Error(`Shark API error: ${resp.status} ${resp.statusText}`);
        }

        const data = await resp.json();
        console.log("Remote sharks from backend:", data);
        console.log("First remote shark:", data[0]);
        setRemoteSharks(data);
      } catch (err) {
        console.error("Failed to fetch remote sharks:", err);
      }
    }

    fetchRemoteSharks();
  }, []);

  const center = track.length
    ? [track[0].latitude, track[0].longitude]
    : [0, 0];

  const polylinePositions = track.map((p) => [p.latitude, p.longitude]);
  const lastPoint = track.length ? track[track.length - 1] : null;

  const activeRemote = remoteSharks.filter(
    (s) => s.latitude != null && s.longitude != null
  );

  return (
    <div className="shark-layout">
      {/* Sidebar */}
      <aside className="shark-sidebar">
        <h2 className="panel-title">Luna overview</h2>

        {!shark && <p className="muted">Loading local track…</p>}

        {shark && (
          <>
            <div className="stat-card">
              <div className="stat-label">Name</div>
              <div className="stat-value">{shark.name}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Species</div>
              <div className="stat-value">{shark.species}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Track points</div>
              <div className="stat-value">{track.length}</div>
            </div>
            {lastPoint && (
              <div className="stat-card">
                <div className="stat-label">Last local ping</div>
                <div className="stat-value">
                  {new Date(lastPoint.timestamp).toLocaleString()}
                </div>
              </div>
            )}
          </>
        )}

        <div className="divider" />

        <h3 className="panel-subtitle">Live OCEARCH sharks</h3>
        <p className="muted">
          Loaded <strong>{activeRemote.length}</strong> shark
          {activeRemote.length === 1 ? "" : "s"} from backend.
        </p>

        <ul className="shark-list">
          {activeRemote.slice(0, 6).map((s) => (
            <li key={s.id} className="shark-list-item">
              <div className="shark-list-name">{s.name}</div>
              <div className="shark-list-meta">
                {s.species || "Unknown species"}
              </div>
            </li>
          ))}
          {activeRemote.length > 6 && (
            <li className="shark-list-more">
              + {activeRemote.length - 6} more…
            </li>
          )}
        </ul>
      </aside>

      {/* Map panel */}
      <section className="shark-map-panel">
        <div className="shark-map-header">
          <div>
            <h2 className="panel-title">Track & live positions</h2>
            <p className="muted">
              Luna&apos;s historical track plus current remote shark locations.
            </p>
          </div>
        </div>

        <div className="shark-map-container">
          <MapContainer
            center={center}
            zoom={8}
            className="shark-map"
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {polylinePositions.length > 1 && (
              <Polyline positions={polylinePositions} />
            )}

            {lastPoint && (
              <Marker position={[lastPoint.latitude, lastPoint.longitude]}>
                <Popup>
                  <strong>Luna – latest position</strong>
                  <br />
                  {new Date(lastPoint.timestamp).toLocaleString()}
                  <br />
                  Lat: {lastPoint.latitude.toFixed(3)}, Lon:{" "}
                  {lastPoint.longitude.toFixed(3)}
                </Popup>
              </Marker>
            )}

            {/* Remote sharks */}
            {activeRemote.map((s) => (
              <Marker key={s.id} position={[s.latitude, s.longitude]}>
                <Popup>
                  <strong>{s.name}</strong>
                  <br />
                  {s.species}
                  <br />
                  Last move: {new Date(s.lastMove).toLocaleString()}
                  <br />
                  Lat: {s.latitude.toFixed(3)}, Lon: {s.longitude.toFixed(3)}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </section>
    </div>
  );
}
