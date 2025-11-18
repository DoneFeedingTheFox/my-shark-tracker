// backend/src/lib/sstClient.ts
// Simple helper to fetch sea surface temperature (SST) in °C
// using the Open-Meteo Marine API (no API key required), with in-memory caching.

const SST_CACHE = new Map<
  string,
  {
    value: number;
    expiresAt: number;
  }
>();

// make a cache key from lat/lon + date (day precision is enough)
function makeCacheKey(latitude: number, longitude: number): string {
  const lat = Number(latitude).toFixed(2); // 0.01° ~ 1 km
  const lon = Number(longitude).toFixed(2);
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${lat},${lon},${day}`;
}

// how long a cached value is valid (ms)
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function fetchSeaSurfaceTemperature(
  latitude: number,
  longitude: number
): Promise<number | null> {
  if (latitude == null || longitude == null) {
    return null;
  }

  const cacheKey = makeCacheKey(latitude, longitude);
  const cached = SST_CACHE.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    // console.log("[SST] cache hit", cacheKey, cached.value);
    return cached.value;
  }

  // console.log("[SST] cache miss", cacheKey);
  const lat = Number(latitude.toFixed(3));
  const lon = Number(longitude.toFixed(3));

  const url = new URL("https://marine-api.open-meteo.com/v1/marine");
  url.searchParams.set("latitude", lat.toString());
  url.searchParams.set("longitude", lon.toString());
  url.searchParams.set("current", "sea_surface_temperature");

  const res = await fetch(url.toString());
  if (!res.ok) {
    console.warn(
      "[SST] Open-Meteo error",
      res.status,
      res.statusText
    );
    return null;
  }

  const json: any = await res.json();

  const value =
    json &&
    json.current &&
    typeof json.current.sea_surface_temperature === "number"
      ? json.current.sea_surface_temperature
      : null;

  if (value == null || Number.isNaN(value)) {
    console.warn("[SST] No numeric sea_surface_temperature in response");
    return null;
  }

  SST_CACHE.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return value; // °C
}
