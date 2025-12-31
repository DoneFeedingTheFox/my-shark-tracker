// src/SharkMap.jsx
import { useEffect, useState, useRef, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-arrowheads";
import "./SharkMap.css"; // styling
import { API_BASE_URL } from "./config";

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

// 🌊 Environment layer URLs

// Base for Sea Surface Temperature (L4, MUR25) from NASA GIBS.
// We'll plug in the TIME parameter dynamically based on the global timeline.
const SST_BASE_URL =
  "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GHRSST_L4_MUR25_Sea_Surface_Temperature/default";

const BATHYMETRY_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}";

// Build SST tile URL for a given date (or "default" for latest)
function buildSstTileUrl(timelineTime) {
  // No timeline yet → fall back to latest "default"
  if (!timelineTime) {
    return `${SST_BASE_URL}/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`;
  }

  // Copy the date so we don't mutate the original
  let d = new Date(timelineTime.getTime());

  // NASA GHRSST L4 is usually 1–2 days behind "now".
  // Clamp anything newer than (today - 2 days) down to (today - 2 days)
  const now = new Date();
  const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
  const maxDate = new Date(now.getTime() - TWO_DAYS_MS);

  if (d.getTime() > maxDate.getTime()) {
    d = maxDate;
  }

  // GIBS expects TIME as YYYY-MM-DD (UTC)
  const isoDate = d.toISOString().slice(0, 10); // "YYYY-MM-DD"
  return `${SST_BASE_URL}/${isoDate}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`;
}

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

  // map ref so we can invalidate size and keep tiles correct
  const mapRef = useRef(null);

  // 🌊 Environment layer toggles
  const [showSst, setShowSst] = useState(true);
  const [showBathymetry, setShowBathymetry] = useState(true);

  // 🌍 Global timeline state (for all animals / environment)
  const [timelineIndex, setTimelineIndex] = useState(0);

  // Debounced timeline just for SST tiles (to avoid reloading on every tiny move)
  const [sstTimelineTime, setSstTimelineTime] = useState(null);

  // New UI state: slide-in drawers
  const [showExplorer, setShowExplorer] = useState(true);
  const [showDetails, setShowDetails] = useState(true);

  // Remote sharks from your backend
  useEffect(() => {
    async function fetchRemoteSharks() {
      try {
        setLoading(true);
        setError(null);
        const resp = await fetch(`${API_BASE_URL}/api/sharks`);
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

  // ✅ UI restriction removed: do NOT filter by monthsBack anymore
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
    // stop playback when shark changes
    setIsPlaying(false);
    // always start from the beginning of the track
    setPlaybackIndex(0);
  }, [selectedShark?.id, selectedTrack.length]);

  // Auto-play effect (per-shark playback)
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
    selectedTrack && selectedTrack.length ? selectedTrack[playbackSafeIndex] : null;

  // Add arrowheads to the full selected-shark track whenever the track changes
  useEffect(() => {
    if (!fullTrackRef.current || !selectedTrack || selectedTrack.length < 2) return;

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

  // 🌍 Build a global sorted list of all track timestamps (ms since epoch)
  const allTimelineTimes = useMemo(() => {
    const times = [];

    for (const shark of remoteSharks) {
      const track = shark.track || [];
      for (const p of track) {
        if (!p || !p.time) continue;
        const t = new Date(p.time).getTime();
        if (!Number.isNaN(t)) {
          times.push(t);
        }
      }
    }

    if (times.length === 0) return [];

    // sort ascending + unique
    times.sort((a, b) => a - b);
    const unique = [times[0]];
    for (let i = 1; i < times.length; i++) {
      if (times[i] !== times[i - 1]) {
        unique.push(times[i]);
      }
    }
    return unique;
  }, [remoteSharks]);

  // When timeline domain changes (new data), snap slider to the latest time
  useEffect(() => {
    if (allTimelineTimes.length > 0) {
      setTimelineIndex(allTimelineTimes.length - 1);
    } else {
      setTimelineIndex(0);
    }
  }, [allTimelineTimes.length]);

  const currentTimelineTime =
    allTimelineTimes.length > 0
      ? new Date(
          allTimelineTimes[
            Math.min(Math.max(timelineIndex, 0), allTimelineTimes.length - 1)
          ]
        )
      : null;

  // Debounce SST updates so we don't reload tiles on every tiny slider move
  useEffect(() => {
    if (!currentTimelineTime) {
      setSstTimelineTime(null);
      return;
    }

    // wait 400ms after the last change before updating SST
    const handle = setTimeout(() => {
      setSstTimelineTime(currentTimelineTime);
    }, 400);

    return () => clearTimeout(handle);
  }, [currentTimelineTime]);

  // SST layer uses the debounced time
  const sstTileUrl = useMemo(() => buildSstTileUrl(sstTimelineTime), [sstTimelineTime]);

  const timelineTimeMs = currentTimelineTime ? currentTimelineTime.getTime() : null;

  // 🔁 Get shark position at current global timeline time
  const getPositionAtTime = (shark) => {
    const track = shark.track || [];

    // If we don't have a timeline or track, fall back to current lat/lon
    if (!timelineTimeMs || !track.length) {
      if (shark.latitude != null && shark.longitude != null) {
        return { lat: shark.latitude, lng: shark.longitude, time: null };
      }
      return null;
    }

    let closest = null; // last point at or before timeline time

    for (const p of track) {
      if (!p || !p.time) continue;
      const t = new Date(p.time).getTime();
      if (Number.isNaN(t)) continue;

      if (t <= timelineTimeMs) {
        if (!closest || t > closest.t) {
          closest = { lat: p.lat, lng: p.lng, time: p.time, t };
        }
      }
    }

    if (closest) {
      return { lat: closest.lat, lng: closest.lng, time: closest.time };
    }

    // If timeline is before first track point, use earliest valid track point
    let first = null;
    for (const p of track) {
      if (!p || !p.time) continue;
      const t = new Date(p.time).getTime();
      if (Number.isNaN(t)) continue;
      if (!first || t < first.t) {
        first = { lat: p.lat, lng: p.lng, time: p.time, t };
      }
    }
    if (first) {
      return { lat: first.lat, lng: first.lng, time: first.time };
    }

    // Fallback again to static lat/lon if nothing else worked
    if (shark.latitude != null && shark.longitude != null) {
      return { lat: shark.latitude, lng: shark.longitude, time: null };
    }
    return null;
  };

  // Map center: follow selected shark at current timeline time
  const center = (() => {
    if (selectedShark) {
      const pos = getPositionAtTime(selectedShark);
      if (pos) return [pos.lat, pos.lng];
      return [selectedShark.latitude, selectedShark.longitude];
    }
    if (activeRemote.length) {
      const pos = getPositionAtTime(activeRemote[0]);
      if (pos) return [pos.lat, pos.lng];
      return [activeRemote[0].latitude, activeRemote[0].longitude];
    }
    return [0, 0];
  })();

  // keep the map view in sync when center changes
  useEffect(() => {
    if (mapRef.current && Array.isArray(center)) {
      mapRef.current.setView(center);
    }
  }, [center]);

  // invalidate size on window resize so Leaflet recalculates tiles
  useEffect(() => {
    const handleResize = () => {
      if (mapRef.current) {
        mapRef.current.invalidateSize();
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="shark-page">
      {/* Fullscreen map background */}
      <div className="shark-map-shell">
        <MapContainer
          center={center}
          zoom={4}
          className="shark-map"
          scrollWheelZoom={true}
          whenCreated={(map) => {
            mapRef.current = map;
            setTimeout(() => {
              map.invalidateSize();
            }, 0);
          }}
        >
          {/* Base OSM layer */}
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* 🌊 Bathymetry overlay */}
          {showBathymetry && (
            <TileLayer
              url={BATHYMETRY_TILE_URL}
              attribution="Bathymetry &copy; Esri & contributors"
              opacity={0.7}
            />
          )}

          {/* 🌡 SST overlay */}
          {showSst && (
            <TileLayer
              url={sstTileUrl}
              attribution="SST imagery &copy; NASA GIBS"
              opacity={0.35}
              className="sst-layer"
            />
          )}

          {/* Background: full tracks for ALL sharks (no time restriction) */}
          {activeRemote.map((s) => {
            const fullTrack = s.track || [];
            if (fullTrack.length < 2) return null;

            // Skip if this is the selected shark
            if (selectedShark && s.id === selectedShark.id) return null;

            return (
              <Polyline
                key={`bg-track-${s.id}`}
                positions={fullTrack.map((p) => [p.lat, p.lng])}
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
                    {p.time ? new Date(p.time).toLocaleString() : "Unknown time"}
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
                      ? new Date(currentPlaybackPoint.time).toLocaleString()
                      : "Playback point"}
                  </Popup>
                </Marker>
              )}
            </>
          )}

          {/* Remote sharks (position following global timeline) */}
          {activeRemote.map((s) => {
            const lastTime = s.last_update || s.lastMove || s.last_move || null;

            const pos = getPositionAtTime(s);
            if (!pos) return null;

            return (
              <Marker
                key={s.id}
                position={[pos.lat, pos.lng]}
                eventHandlers={{
                  click(e) {
                    // click selects shark in sidebar and ensures popup is open
                    setSelectedSharkId(s.id);
                    if (e && e.target && typeof e.target.openPopup === "function") {
                      e.target.openPopup();
                    }
                  },
                  mouseover(e) {
                    // hover shows popup (does NOT change selected shark)
                    if (e && e.target && typeof e.target.openPopup === "function") {
                      e.target.openPopup();
                    }
                  },
                  mouseout(e) {
                    // leaving marker hides popup
                    if (e && e.target && typeof e.target.closePopup === "function") {
                      e.target.closePopup();
                    }
                  },
                }}
              >
                <Popup>
                  <strong>{s.name}</strong>
                  <br />
                  {s.imageUrl && (
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
                  Lat: {pos.lat.toFixed(3)}, Lon: {pos.lng.toFixed(3)}
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      {/* Floating toggles */}
      <button
        className="drawer-toggle drawer-toggle-left"
        onClick={() => setShowExplorer((v) => !v)}
      >
        ☰ Filters
      </button>

      <button
        className="drawer-toggle drawer-toggle-right"
        onClick={() => setShowDetails((v) => !v)}
      >
        🦈 Details
      </button>

      {/* LEFT: Shark Explorer drawer */}
      <aside className={`drawer drawer-left ${showExplorer ? "drawer-open" : ""}`}>
        <h2 className="panel-title">Shark explorer</h2>

        {loading && (
          <p className="muted" style={{ marginBottom: "0.75rem" }}>
            Loading sharks from backend…
          </p>
        )}

        {!loading && error && (
          <p className="muted" style={{ marginBottom: "0.75rem", color: "#f97373" }}>
            Could not reach backend, please try again.
          </p>
        )}

        {/* Time filter slider (currently does not filter activeRemote) */}
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
          <div className="muted" style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>
            Since {fromDate.toLocaleDateString()}
          </div>
        </div>

        {/* 🌊 Environment layer toggles */}
        <div className="stat-card">
          <div className="stat-label">Environment layers</div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.35rem",
              marginTop: "0.35rem",
              fontSize: "0.9rem",
            }}
          >
            <label
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={showSst}
                onChange={(e) => setShowSst(e.target.checked)}
              />
              <span>Sea surface temperature</span>
            </label>

            <label
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={showBathymetry}
                onChange={(e) => setShowBathymetry(e.target.checked)}
              />
              <span>Bathymetry (ocean depth)</span>
            </label>
          </div>
        </div>

        {/* SST legend / explanation – only show when SST layer is on */}
        {showSst && (
          <div className="stat-card">
            <div className="stat-label">Sea surface temperature legend</div>
            <div
              style={{
                marginTop: "0.35rem",
                fontSize: "0.85rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.35rem",
              }}
            >
              <div
                style={{
                  height: "10px",
                  borderRadius: "999px",
                  overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.1)",
                  background:
                    "linear-gradient(90deg, #001f4d 0%, #005b96 20%, #00bcd4 40%, #8bc34a 55%, #ffeb3b 70%, #ff9800 85%, #f44336 100%)",
                }}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "0.75rem",
                }}
              >
                <span>~0 °C</span>
                <span>~10 °C</span>
                <span>~20 °C</span>
                <span>~30 °C+</span>
              </div>
              <p className="muted" style={{ fontSize: "0.75rem", lineHeight: 1.4 }}>
                Colors show <strong>sea surface temperature</strong> from the NASA GHRSST
                MUR dataset. Dark blues are cold water, greens/yellows are temperate,
                and oranges/reds are warm tropical waters. Values are approximate and
                usually 1–2 days behind real time.
              </p>
            </div>
          </div>
        )}

        <div className="divider" />

        <p className="muted">
          Active in range: <strong>{activeRemote.length}</strong> / Total fetched:{" "}
          <strong>{remoteSharks.length}</strong>
        </p>
      </aside>

      {/* RIGHT: Selected shark drawer */}
      <aside className={`drawer drawer-right ${showDetails ? "drawer-open" : ""}`}>
        <h3 className="panel-subtitle">Selected shark</h3>

        {!loading && !error && !selectedShark && (
          <p className="muted">
            No sharks in this time range. Try moving the slider to include more months,
            then click a marker on the map to see details.
          </p>
        )}

        {!loading && !error && selectedShark && (
          <>
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
              <div className="stat-value">{selectedShark.species || "Unknown species"}</div>
            </div>

            <div className="stat-card">
              <div className="stat-label">Last update</div>
              <div className="stat-value">
                {selectedShark.last_update
                  ? new Date(selectedShark.last_update).toLocaleString()
                  : selectedShark.lastMove || selectedShark.last_move
                  ? new Date(selectedShark.lastMove || selectedShark.last_move).toLocaleString()
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

            {/* Playback section (per-shark) */}
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

                  <div className="muted" style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>
                    {selectedTrack[0]?.time && selectedTrack[selectedTrack.length - 1]?.time && (
                      <>
                        {new Date(selectedTrack[0].time).toLocaleString()} →{" "}
                        {new Date(selectedTrack[selectedTrack.length - 1].time).toLocaleString()}
                        <br />
                      </>
                    )}

                    {currentPlaybackPoint?.time && (
                      <>
                        Current: {new Date(currentPlaybackPoint.time).toLocaleString()}
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
      </aside>

      {/* 🌍 Global timeline slider – floating at the bottom */}
      <div className="timeline-bar timeline-floating">
        <div className="timeline-info">
          {currentTimelineTime ? (
            <>
              Timeline: <strong>{currentTimelineTime.toLocaleString()}</strong>
            </>
          ) : (
            <>
              Timeline: <span className="muted">No track data</span>
            </>
          )}
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(allTimelineTimes.length - 1, 0)}
          value={
            allTimelineTimes.length > 0
              ? Math.min(Math.max(timelineIndex, 0), allTimelineTimes.length - 1)
              : 0
          }
          onChange={(e) => setTimelineIndex(Number(e.target.value))}
          disabled={allTimelineTimes.length === 0}
          className="timeline-slider"
        />
      </div>
    </div>
  );
}
