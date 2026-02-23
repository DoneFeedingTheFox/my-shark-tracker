"use strict";
// backend/src/lib/sstClient.ts
// Helpers to fetch near-real-time ocean conditions from the Open-Meteo Marine API
// (no API key required), with in-memory caching.
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchSeaSurfaceTemperature = fetchSeaSurfaceTemperature;
exports.fetchWaveHeight = fetchWaveHeight;
const MARINE_CACHE = new Map();
// make a cache key from lat/lon + date (day precision is enough)
function makeCacheKey(latitude, longitude) {
    const lat = Number(latitude).toFixed(2); // 0.01° ~ 1 km
    const lon = Number(longitude).toFixed(2);
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `${lat},${lon},${day}`;
}
// how long a cached value is valid (ms)
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
function safeNumber(value) {
    return typeof value === "number" && !Number.isNaN(value) ? value : null;
}
async function fetchMarineSnapshot(latitude, longitude) {
    if (latitude == null || longitude == null) {
        return { sst: null, waveHeight: null };
    }
    const cacheKey = makeCacheKey(latitude, longitude);
    const cached = MARINE_CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
    }
    const lat = Number(latitude.toFixed(3));
    const lon = Number(longitude.toFixed(3));
    const url = new URL("https://marine-api.open-meteo.com/v1/marine");
    url.searchParams.set("latitude", lat.toString());
    url.searchParams.set("longitude", lon.toString());
    url.searchParams.set("current", "sea_surface_temperature,wave_height");
    const res = await fetch(url.toString());
    if (!res.ok) {
        console.warn("[Marine] Open-Meteo error", res.status, res.statusText);
        return { sst: null, waveHeight: null };
    }
    const json = await res.json();
    const snapshot = {
        sst: safeNumber(json?.current?.sea_surface_temperature),
        waveHeight: safeNumber(json?.current?.wave_height),
    };
    MARINE_CACHE.set(cacheKey, {
        value: snapshot,
        expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return snapshot;
}
async function fetchSeaSurfaceTemperature(latitude, longitude) {
    const snapshot = await fetchMarineSnapshot(latitude, longitude);
    return snapshot.sst;
}
async function fetchWaveHeight(latitude, longitude) {
    const snapshot = await fetchMarineSnapshot(latitude, longitude);
    return snapshot.waveHeight;
}
