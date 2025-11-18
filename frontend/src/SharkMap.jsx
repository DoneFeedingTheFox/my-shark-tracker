// src/SharkMap.jsx
import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
} from "react-leaflet";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // NEW: track + playback state
  const [selectedTrack, setSelectedTrack] = useState([]);
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackError, setTrackError] = useState(null);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Remote sharks from your backend
  useEffect(() => {
    async function fetchRemoteSharks() {
      try {
        setLoading(true);
        setError(null);

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
        setLoading(false);
      } catch (err) {
        console.error("Failed to fetch remote sharks:", err);
        setError(err.message || "Unknown error");
        setLoading(false);
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

  // Fetch track from backend whenever selected shark changes
  useEffect(() => {
    async function fetchTrack() {
      if (!selectedShark) {
        setSelectedTrack([]);
        setTrackLoading(false);
        setTrackError(null);
        setIsPlaying(false);
        setPlaybackIndex(0);
        return;
      }

      try {
        setTrackLoading(true);
        setTrackError(null);
        setIsPlaying(false);
        setPlaybackIndex(0);

        const resp = await fetch(
          `https://shark-backend-yz6s.onrender.com/api/sharks/${selectedShark.id}/track?hours=24`
        );
        if (!resp.ok) {
          throw new Error(
            `Track API error: ${resp.status} ${resp.statusText}`
          );
        }

        const data = await resp.json();

        // Make sure we have an array of { latitude, longitude, timestamp }
        const cleaned = Array.isArray(data) ? data : [];
        cleaned.sort((a, b) => {
          const ta = new Date(a.timestamp || 0).getTime();
          const tb = new Date(b.timestamp || 0).getTime();
          return ta - tb;
        });

        setSelectedTrack(cleaned);
        setPlaybackIndex(cleaned.length > 0 ? cleaned.length - 1 : 0);
      } catch (err) {
        console.error("Failed to fetch shark track:", err);
        setTrackError(err.message || "Unknown track error");
        setSelectedTrack([]);
      } finally {
        setTrackLoading(false);
      }
    }

    fetchTrack();
  }, [selectedShark?.id]);

  // Auto-play effect
  useEffect(() => {
    if (!isPlaying || !selectedTrack || selectedTrack.length <= 1) return;

    const maxIndex = selectedTrack.length - 1;

    const interval = setInterval(() => {
      setPlaybackIndex((prev) => {
        if (prev >= maxIndex) {
          clearInterval(interval);
          return maxIndex;
        }
        return prev + 1;
      });
    }, 300); // ms between steps

    return () => clearInterval(interval);
  }, [isPlaying, selectedTrack]);

  const playbackSafeIndex =
    selectedTrack && selectedTrack.length
      ? Math.min(playbackIndex, selectedTrack.length - 1)
      : 0;

  const currentPlaybackPoint =
    selectedTrack && selectedTrack.length
      ? selectedTrack[playbackSafeIndex]
      : null;

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
        {loading && (
          <p className="muted" style={{ marginBottom: "0.75rem" }}>
            Loading sharks from backend…
          </p>
        )}

        {!loading && error && (
          <p
            className="muted"
            style={{ marginBottom: "0.75rem", color: "#f97373" }}
          >
            Could not reach backend, please try again.
          </p>
        )}

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

        {!loading && !error && !selectedShark && (
          <p className="muted">
            No sharks in this time range. Try moving the slider to include more
            months, then click a marker on the map to see details.
          </p>
        )}

        {!loading && !error && selectedShark && (
          <>
            {/* 📷 Image for selected shark */}
            {selectedShark.imageUrl && (
              <div className="stat-card">
                <div className="stat-label">Photo</div>
                <img
                  src={selectedShark.imageUrl}
                  alt={selectedShark.name}
                  style={{
                    width: "100%",
                    maxHeight: "220px",
                    objectFit: "cover",
                    borderRadius: "12px",
                    marginTop: "0.35rem",
                  }}
                />
              </div>
            )}

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

            {/* Playback section */}
            <div className="stat-card">
              <div className="stat-label">Playback</div>

              {trackLoading && (
                <p className="muted" style={{ marginTop: "0.35rem" }}>
                  Loading track…
                </p>
              )}

              {!trackLoading && trackError && (
                <p
                  className="muted"
                  style={{ marginTop: "0.35rem", color: "#f97373" }}
                >
                  Could not load track: {trackError}
                </p>
              )}

              {!trackLoading &&
                !trackError &&
                selectedTrack.length === 0 && (
                  <p className="muted" style={{ marginTop: "0.35rem" }}>
                    No historical data available for this shark.
                  </p>
                )}

              {!trackLoading &&
                !trackError &&
                selectedTrack.length > 1 && (
                  <>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                        marginTop: "0.35rem",
                      }}
                    >
                      <button onClick={() => setIsPlaying((prev) => !prev)}>
                        {isPlaying ? "Pause" : "Play"}
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={selectedTrack.length - 1}
                        value={playbackSafeIndex}
                        onChange={(e) => {
                          setPlaybackIndex(Number(e.target.value));
                          setIsPlaying(false); // dragging pauses playback
                        }}
                        style={{ flex: 1 }}
                      />
                    </div>

                    <div
                      className="muted"
                      style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}
                    >
                      {selectedTrack[0]?.timestamp &&
                        selectedTrack[selectedTrack.length - 1]?.timestamp && (
                          <>
                            {new Date(
                              selectedTrack[0].timestamp
                            ).toLocaleString()}{" "}
                            →{" "}
                            {new Date(
                              selectedTrack[
                                selectedTrack.length - 1
                              ].timestamp
                            ).toLocaleString()}
                            <br />
                          </>
                        )}

                      {currentPlaybackPoint?.timestamp && (
                        <>
                          Current:{" "}
                          {new Date(
                            currentPlaybackPoint.timestamp
                          ).toLocaleString()}
                        </>
                      )}
                    </div>
                  </>
                )}
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

            {/* Track + playback marker for selected shark */}
            {selectedTrack && selectedTrack.length > 0 && (
              <>
                {/* Full track */}
                <Polyline
                  positions={selectedTrack.map((p) => [
                    p.latitude,
                    p.longitude,
                  ])}
                />

                {/* Played-so-far track */}
                {selectedTrack.length > 1 && (
                  <Polyline
                    positions={selectedTrack
                      .slice(0, playbackSafeIndex + 1)
                      .map((p) => [p.latitude, p.longitude])}
                  />
                )}

                {/* Moving playback marker */}
                {currentPlaybackPoint && (
                  <Marker
                    position={[
                      currentPlaybackPoint.latitude,
                      currentPlaybackPoint.longitude,
                    ]}
                  >
                    <Popup>
                      <strong>{selectedShark?.name}</strong>
                      <br />
                      {currentPlaybackPoint.timestamp
                        ? new Date(
                            currentPlaybackPoint.timestamp
                          ).toLocaleString()
                        : "Playback point"}
                    </Popup>
                  </Marker>
                )}
              </>
            )}

            {/* Remote sharks (last known position) */}
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
                    {s.imageUrl && (
                      <>
                        <img
                          src={s.imageUrl}
                          alt={s.name}
                          style={{
                            width: "100%",
                            maxHeight: "150px",
                            objectFit: "cover",
                            borderRadius: "8px",
                            margin: "0.25rem 0",
                          }}
                        />
                      </>
                    )}
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
