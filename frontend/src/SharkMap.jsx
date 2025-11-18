// src/SharkMap.jsx
import { useEffect, useState, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-arrowheads";
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
const WEEK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

  // playback state (track now comes from selectedShark.track)
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // ref to the full track polyline (for arrowheads)
  const fullTrackRef = useRef(null);

  // Remote sharks from your backend
  useEffect(() => {
    async function fetchRemoteSharks() {
      try {
        setLoading(true);
        setError(null);

        // Local backend while developing; swap to Render URL for prod
        const resp = await fetch("https://shark-backend-yz6s.onrender.com");
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

  // FULL track for selected shark (all history from backend)
  const selectedTrack = selectedShark?.track || [];

  // Reset playback whenever shark/track changes
  useEffect(() => {
    setIsPlaying(false);
    if (selectedTrack.length > 0) {
      setPlaybackIndex(selectedTrack.length - 1);
    } else {
      setPlaybackIndex(0);
    }
  }, [selectedShark?.id, selectedTrack.length]);

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
  }, [isPlaying, selectedTrack, selectedTrack.length]);

  const playbackSafeIndex =
    selectedTrack && selectedTrack.length
      ? Math.min(playbackIndex, selectedTrack.length - 1)
      : 0;

  const currentPlaybackPoint =
    selectedTrack && selectedTrack.length
      ? selectedTrack[playbackSafeIndex]
      : null;

  // Add arrowheads to the full selected-shark track whenever the track changes
  useEffect(() => {
    if (!fullTrackRef.current || !selectedTrack || selectedTrack.length < 2)
      return;

    const polyline = fullTrackRef.current;

    // keep line visually clear
    polyline.setStyle({ color: "#00bcd4", weight: 3, opacity: 0.9 });

    // add arrowheads for direction (plugin patches the prototype)
    if (typeof polyline.arrowheads === "function") {
      polyline.arrowheads({
        size: "10px",
        frequency: "40px",
        fill: true,
      });
    }
  }, [selectedTrack, selectedShark?.id]);

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

              {selectedTrack.length === 0 && (
                <p className="muted" style={{ marginTop: "0.35rem" }}>
                  No historical data available for this shark.
                </p>
              )}

              {selectedTrack.length > 1 && (
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
                    {selectedTrack[0]?.time &&
                      selectedTrack[selectedTrack.length - 1]?.time && (
                        <>
                          {new Date(
                            selectedTrack[0].time
                          ).toLocaleString()}{" "}
                          →{" "}
                          {new Date(
                            selectedTrack[selectedTrack.length - 1].time
                          ).toLocaleString()}
                          <br />
                        </>
                      )}

                    {currentPlaybackPoint?.time && (
                      <>
                        Current:{" "}
                        {new Date(currentPlaybackPoint.time).toLocaleString()}
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

            {/* Background: 7-day tracks for ALL sharks */}
            {activeRemote.map((s) => {
              const fullTrack = s.track || [];
              if (!fullTrack.length) return null;

              const cutoff = now.getTime() - WEEK_MS;
              const recentTrack = fullTrack.filter((p) => {
                if (!p.time) return false;
                const t = new Date(p.time).getTime();
                return !isNaN(t) && t >= cutoff;
              });

              // Skip if not enough points, or if this is the selected shark
              if (
                !recentTrack ||
                recentTrack.length < 2 ||
                (selectedShark && s.id === selectedShark.id)
              ) {
                return null;
              }

              return (
                <Polyline
                  key={`bg-track-${s.id}`}
                  positions={recentTrack.map((p) => [p.lat, p.lng])}
                  pathOptions={{
                    color: "#00bcd4",
                    weight: 2,
                    opacity: 0.35,
                  }}
                />
              );
            })}

            {/* Track + playback marker for SELECTED shark (full history) */}
            {selectedTrack && selectedTrack.length > 0 && (
              <>
                {/* Full track polyline (with arrows) */}
                <Polyline
                  ref={fullTrackRef}
                  positions={selectedTrack.map((p) => [p.lat, p.lng])}
                  pathOptions={{ color: "#00bcd4", weight: 3, opacity: 0.9 }}
                />

                {/* Played-so-far track (slightly different style) */}
                {selectedTrack.length > 1 && (
                  <Polyline
                    positions={selectedTrack
                      .slice(0, playbackSafeIndex + 1)
                      .map((p) => [p.lat, p.lng])}
                    pathOptions={{ color: "#ffffff", weight: 4, opacity: 0.35 }}
                  />
                )}

                {/* Small dated points along the full path */}
                {selectedTrack.map((p, i) => (
                  <Marker
                    key={`track-point-${i}`}
                    position={[p.lat, p.lng]}
                    icon={L.divIcon({
                      className: "track-point-icon",
                      html: '<div class="track-point-dot"></div>',
                    })}
                  >
                    <Popup>
                      <strong>{selectedShark?.name}</strong>
                      <br />
                      {p.time
                        ? new Date(p.time).toLocaleString()
                        : "Unknown time"}
                    </Popup>
                  </Marker>
                ))}

                {/* Moving playback marker – small dot so it doesn't hide the line */}
                {currentPlaybackPoint && (
                  <Marker
                    position={[currentPlaybackPoint.lat, currentPlaybackPoint.lng]}
                    icon={L.divIcon({
                      className: "playback-point-icon",
                      html: '<div class="playback-point-dot"></div>',
                    })}
                  >
                    <Popup>
                      <strong>{selectedShark?.name}</strong>
                      <br />
                      {currentPlaybackPoint.time
                        ? new Date(
                            currentPlaybackPoint.time
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
