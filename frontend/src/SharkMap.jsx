import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

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
  const [remoteSharks, setRemoteSharks] = useState([]); // new: sharks from backend

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
        const resp = await fetch("http://localhost:3000/api/sharks");
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

  return (
    <div style={{ display: "flex", gap: "1rem" }}>
      <div style={{ width: "250px" }}>
        <h2>My Shark</h2>
        {!shark && <p>Loading…</p>}
        {shark && (
          <>
            <p>
              <strong>Name:</strong> {shark.name}
            </p>
            <p>
              <strong>Species:</strong> {shark.species}
            </p>
            <p>Track points: {track.length}</p>
          </>
        )}

        <hr />
        <h3>Live OCEARCH sharks</h3>
        <p>Loaded: {remoteSharks.length}</p>
        {/* we’ll add map markers for these in the next step */}
      </div>

      <div style={{ flex: 1, height: "500px" }}>
        <MapContainer center={center} zoom={8} style={{ width: "100%", height: "100%" }}>
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
                Latest position<br />
                {new Date(lastPoint.timestamp).toLocaleString()}<br />
                Lat: {lastPoint.latitude.toFixed(3)}, Lon: {lastPoint.longitude.toFixed(3)}
              </Popup>
            </Marker>
          )}

          {/* 🦈 NEW: OCEARCH sharks */}
          {remoteSharks.map((s) => (
            <Marker key={s.id} position={[s.latitude, s.longitude]}>
              <Popup>
                <strong>{s.name}</strong><br />
                {s.species}<br />
                Last seen: {new Date(s.lastMove).toLocaleString()}<br/>
                Lat: {s.latitude.toFixed(3)}, Lon: {s.longitude.toFixed(3)}
              </Popup>
            </Marker>
          ))}
        </MapContainer>

      </div>
    </div>
  );
}
