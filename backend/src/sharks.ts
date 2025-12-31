// backend/src/sharks.ts
import express from "express";
// import fetch from "node-fetch"; // no longer needed
import { supabaseAdmin } from "./lib/supabaseAdmin";
import { fetchSeaSurfaceTemperature } from "./lib/sstClient";

export interface SharkTrackPoint {
  lat: number;
  lng: number;
  time: string; // ISO string
}

export interface Shark {
  id: number; // external_id exposed to frontend
  name: string;
  species: string;
  latitude: number;
  longitude: number;
  imageUrl?: string | null;
  last_update?: string | null;
  zPing?: boolean | null;
  zPingTime?: string | null;
  approxSst?: number | null;
  track?: SharkTrackPoint[];
}

const router = express.Router();

/**
 * Adds approximate SST in °C for each shark using a cached helper.
 * Runs sequentially to avoid rate limiting (429).
 */
async function addApproxSstToSharks(sharks: Shark[]): Promise<Shark[]> {
  const out: Shark[] = [];
  for (const s of sharks) {
    try {
      const sst = await fetchSeaSurfaceTemperature(s.latitude, s.longitude);
      out.push({ ...s, approxSst: sst ?? null });
    } catch (e) {
      // If SST fails, keep shark data intact.
      out.push({ ...s, approxSst: null });
    }
  }
  return out;
}

/**
 * GET /api/sharks
 *
 * Returns sharks + full historical track data from Supabase.
 *
 * Tables:
 *  - sharks(id, external_id, name, species, image_url, last_update, ...)
 *  - shark_positions(shark_id, lat, lng, source_timestamp, created_at)
 */
router.get("/sharks", async (_req, res) => {
  try {
    // 1) Load all sharks
    const { data: sharkRows, error: sharkError } = await supabaseAdmin
      .from("sharks")
      .select("id, external_id, name, species, image_url, last_update, z_ping, z_ping_time")
      .order("id", { ascending: true });

    if (sharkError) {
      console.error("Supabase sharks error:", sharkError);
      return res.status(500).json({ error: sharkError.message });
    }

    const sharksDb = sharkRows ?? [];

    if (sharksDb.length === 0) {
      return res.json([]);
    }

    // Map internal shark.id -> external_id etc.
    const internalIds = sharksDb.map((s) => s.id);

    // 2) Load ALL positions for those sharks (NO TIME RESTRICTION)
    const { data: posRows, error: posError } = await supabaseAdmin
      .from("shark_positions")
      .select("shark_id, lat, lng, source_timestamp, created_at")
      .in("shark_id", internalIds)
      .order("created_at", { ascending: true });

    if (posError) {
      console.error("Supabase shark_positions error:", posError);
      return res.status(500).json({ error: posError.message });
    }

    const positions = posRows ?? [];

    // 3) Group positions by internal shark_id -> track[]
    const trackByShark = new Map<number, SharkTrackPoint[]>();

    for (const row of positions) {
      const sid = row.shark_id as number;
      const lat = Number(row.lat);
      const lng = Number(row.lng);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const time = (row.source_timestamp ?? row.created_at) as string;

      const list = trackByShark.get(sid) ?? [];
      list.push({ lat, lng, time });
      trackByShark.set(sid, list);
    }

    // Helper: get latest point for a shark track
    const getLatest = (track: SharkTrackPoint[]) =>
      track.length ? track[track.length - 1] : null;

    // Build response objects keyed by external_id as `id`
    const sharks: Shark[] = sharksDb
      .map((row: any) => {
        const internalId = row.id as number;
        const externalId = row.external_id as number;

        const track = trackByShark.get(internalId) ?? [];
        const latest = getLatest(track);

        // If no positions exist at all, we cannot place it on the map.
        // You can choose to still return it with null coords, but current UI expects numbers.
        if (!latest) return null;

        const imageUrlFromDb = row.image_url ?? null;

        const shark: Shark = {
          id: externalId,
          name: row.name ?? `Shark ${externalId}`,
          species: row.species ?? "Unknown species",
          latitude: Number(latest.lat),
          longitude: Number(latest.lng),
          imageUrl: imageUrlFromDb,
          last_update: row.last_update ?? latest.time ?? null,
          zPing: row.z_ping ?? null,
          zPingTime: row.z_ping_time ?? null,
          track,
        };

        return shark;
      })
      .filter((s): s is Shark => s !== null);

    // 4) Add approximate SST (°C)
    const sharksWithSst = await addApproxSstToSharks(sharks);

    return res.json(sharksWithSst);
  } catch (err: any) {
    console.error("Error in /api/sharks (db-based):", err);
    return res
      .status(500)
      .json({ error: err?.message ?? "Internal server error" });
  }
});

/**
 * GET /api/sharks/:id/track?hours=24
 *
 * :id    = external_id from Mapotic (same as `id` from /api/sharks)
 * hours  = OPTIONAL: how many hours back to return (if omitted, returns full history)
 *
 * Uses Supabase tables:
 *   sharks(external_id) -> sharks(id)
 *   shark_positions(shark_id, lat, lng, source_timestamp, created_at)
 */
router.get("/sharks/:id/track", async (req, res) => {
  try {
    const externalId = req.params.id; // Mapotic id as string
    const hoursRaw = req.query.hours as string | undefined;

    // If `hours` is provided, filter to that recent window. If omitted, return full history.
    const hours = hoursRaw ? Number(hoursRaw) : null;

    const sinceIso =
      hours != null && Number.isFinite(hours) && hours > 0
        ? new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
        : null;

    // 1) find internal shark.id from external_id
    const { data: sharkRow, error: sharkError } = await supabaseAdmin
      .from("sharks")
      .select("id")
      .eq("external_id", externalId)
      .single();

    if (sharkError) {
      console.error("Supabase sharks lookup error:", sharkError);
      // frontend treats [] as "no data", so don't 500 here
      return res.json([]);
    }

    if (!sharkRow) {
      return res.json([]);
    }

    const sharkId = sharkRow.id;

    // 2) get historical positions (NO RESTRICTION unless hours is provided)
    let posQuery = supabaseAdmin
      .from("shark_positions")
      .select("lat, lng, source_timestamp, created_at")
      .eq("shark_id", sharkId);

    if (sinceIso) {
      posQuery = posQuery.gte("created_at", sinceIso);
    }

    const { data: positions, error: posError } = await posQuery.order(
      "created_at",
      { ascending: true }
    );

    if (posError) {
      console.error("Supabase shark_positions error:", posError);
      return res.status(500).json({ error: posError.message });
    }

    const result =
      positions?.map((row) => ({
        latitude: row.lat,
        longitude: row.lng,
        timestamp: row.source_timestamp ?? row.created_at,
      })) ?? [];

    return res.json(result);
  } catch (err: any) {
    console.error("Error in /api/sharks/:id/track:", err);
    return res
      .status(500)
      .json({ error: err?.message ?? "Internal server error" });
  }
});

export default router;
