// src/SharkMap.jsx
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./SharkMap.css"; // styling

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

const DEFAULT_MONTHS_BACK = 6;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function isSharkWithinMonths(shark, months) {
  const timestamp =
    shark.last_update ||
    shark.lastMove ||
    shark.last_move ||
    shark.last_update_time ||
    null;

  if (!timestamp) return false;

  const lastUpdate = new Date(timestamp);
  if (isNaN(lastUpdate.getTime())) return false; // bad date

  const now = new Date();
  const diffDays = (now.getTime() - lastUpdate.getTime()) / MS_PER_DAY;
  const maxDays = months * 30; // rough month length is fine

  return diffDays <= maxDays;
}

function formatMonthsLabel(months) {
  if (months < 12) {
    return `${months} month${months === 1 ? "" : "s"}`;
  }

  const years = months / 12;
  const rounded = years.toFixed(1);
  return `${rounded} year${rounded === "1.0" ? "" : "s"}`;
}

export default function SharkMap() {
  const [remoteSharks, setRemoteSharks] = useState([]);
  const [monthsBack, setMonthsBack] = useState(DEFAULT_MONTHS_BACK);
  const [selectedSharkId, setSelectedSharkId] = useState(null);

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

  const activeRemote = remoteSharks.filter(
    (s) =>
      s.latitude != null &&
      s.longitude != null &&
      isSharkWithinMonths(s, monthsBack)
  );

  const now = new Date();
  const fromDate = new Date(now);
  fromDate.setMonth(now.getMonth() - monthsBack);

  // Derive selected shark from ID + active list
  const selectedShark =
    activeRemote.find((s) => s.id === selectedSharkId) ||
    (activeRemote.length > 0 ? activeRemote[0] : null);

  // Map center: follow selected shark if any, else first active, else [0,0]
  const center = selectedShark
    ? [selectedShark.latitude, selectedShark.longitude]
    : activeRemote.length
    ? [activeRemote[0].latitude, activeRemote[0].longitude]
    : [0, 0];

  return (
    <div className="shark-layout">
      {/* Sidebar */}
      <aside className="shark-sidebar">
        <h2 className="panel-title">Shark explorer</h2>

        {/* Time filter slider */}
        <div className="stat-card">
          <div className="stat-label">Show sharks active in last</div>
          <div className="stat-value">{formatMonthsLabel(monthsBack)}</div>
          <input
            type="range"
            min={1}
            max={36}
            value={monthsBack}
            onChange={(e) => setMonthsBack(Number(e.target.value))}
          />
          <div
            className="muted"
            style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}
          >
            Since {fromDate.toLocaleDateString()}
          </div>
        </div>

        <div className="divider" />

        <h3 className="panel-subtitle">Selected shark</h3>

        {!selectedShark && (
          <p className="muted">
            No sharks in this time range. Try moving the slider to include more
            months, then click a marker on the map to see details.
          </p>
        )}

        {selectedShark && (
          <>
            <div className="stat-card">
              <div className="stat-label">Name</div>
              <div className="stat-value">{selectedShark.name}</div>
            </div>

            <div className="stat-card">
              <div className="stat-label">Species</div>
              <div className="stat-value">
                {selectedShark.species || "Unknown species"}
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-label">Last update</div>
              <div className="stat-value">
                {selectedShark.last_update
                  ? new Date(selectedShark.last_update).toLocaleString()
                  : selectedShark.lastMove || selectedShark.last_move
                  ? new Date(
                      selectedShark.lastMove || selectedShark.last_move
                    ).toLocaleString()
                  : "Unknown"}
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-label">Location</div>
              <div className="stat-value">
                Lat: {selectedShark.latitude.toFixed(3)}, Lon:{" "}
                {selectedShark.longitude.toFixed(3)}
              </div>
            </div>

            <p className="muted" style={{ marginTop: "0.5rem" }}>
              Tip: click a different marker on the map to switch shark.
            </p>
          </>
        )}

        <div className="divider" />

        <p className="muted">
          Active in range: <strong>{activeRemote.length}</strong> / Total
          fetched: <strong>{remoteSharks.length}</strong>
        </p>
      </aside>

      {/* Map panel */}
      <section className="shark-map-panel">
        <div className="shark-map-header">
          <div>
            <h2 className="panel-title">Shark map</h2>
            <p className="muted">
              Current locations of tracked sharks from the backend. Click a
              marker to see details in the sidebar.
            </p>
          </div>
        </div>

        <div className="shark-map-container">
          <MapContainer
            center={center}
            zoom={4}
            className="shark-map"
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* Remote sharks */}
            {activeRemote.map((s) => {
              const lastTime =
                s.last_update || s.lastMove || s.last_move || null;

              return (
                <Marker
                  key={s.id}
                  position={[s.latitude, s.longitude]}
                  eventHandlers={{
                    click() {
                      setSelectedSharkId(s.id);
                    },
                  }}
                >
                  <Popup>
                    <strong>{s.name}</strong>
                    <br />
                    {s.species || "Unknown species"}
                    <br />
                    {lastTime ? (
                      <>
                        Last update: {new Date(lastTime).toLocaleString()}
                        <br />
                      </>
                    ) : (
                      <>
                        Last update: Unknown
                        <br />
                      </>
                    )}
                    Lat: {s.latitude.toFixed(3)}, Lon: {s.longitude.toFixed(3)}
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        </div>
      </section>
    </div>
  );
}
