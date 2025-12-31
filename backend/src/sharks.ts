// backend/src/sharks.ts
import express from "express";
import { supabaseAdmin } from "./lib/supabaseAdmin";
import { fetchSeaSurfaceTemperature } from "./lib/sstClient";

export interface SharkTrackPoint {
  lat: number;
  lng: number;
  time: string; // ISO string
}

export interface Shark {
  id: number; // numeric ID exposed to frontend (prefer external_id if numeric)
  external_id?: string; // keep for reference/debugging
  name: string;
  species: string;
  latitude: number;
  longitude: number;
  imageUrl?: string | null;
  last_update?: string | null;
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
    } catch {
      out.push({ ...s, approxSst: null });
    }
  }
  return out;
}

function safeIso(value: any): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * GET /api/sharks
 *
 * Returns sharks + full historical track data from Supabase.
 *
 * Tables:
 *  - sharks(id, external_id(TEXT), name, species, image_url, updated_at, ...)
 *  - shark_positions(shark_id, lat, lng, source_timestamp, created_at)
 */
router.get("/sharks", async (_req, res) => {
  try {
    // 1) Load all sharks
    const { data: sharkRows, error: sharkError } = await supabaseAdmin
      .from("sharks")
      .select("id, external_id, name, species, image_url, updated_at")
      .order("id", { ascending: true });

    if (sharkError) {
      console.error("Supabase sharks error:", sharkError);
      return res.status(500).json({ error: sharkError.message });
    }

    const sharksDb = sharkRows ?? [];
    if (sharksDb.length === 0) return res.json([]);

    // 2) Load ALL positions for those sharks (NO TIME RESTRICTION)
    const internalIds = sharksDb.map((s: any) => s.id);

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

    for (const row of positions as any[]) {
      const sid = row.shark_id as number;
      const lat = Number(row.lat);
      const lng = Number(row.lng);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const time =
        (row.source_timestamp ?? row.created_at) as string | undefined;

      const isoTime = safeIso(time);
      if (!isoTime) continue;

      const list = trackByShark.get(sid) ?? [];
      list.push({ lat, lng, time: isoTime });
      trackByShark.set(sid, list);
    }

    const getLatest = (track: SharkTrackPoint[]) =>
      track.length ? track[track.length - 1] : null;

    // 4) Build response
    const sharks: Shark[] = (sharksDb as any[])
      .map((row) => {
        const internalId = Number(row.id);
        const externalIdRaw = row.external_id as string | null | undefined;

        // external_id is TEXT in your schema; convert if numeric
        const externalIdNum =
          externalIdRaw != null ? Number(externalIdRaw) : NaN;

        const track = trackByShark.get(internalId) ?? [];
        const latest = getLatest(track);
        if (!latest) return null; // cannot place on map if no positions exist

        const apiId = Number.isFinite(externalIdNum) ? externalIdNum : internalId;

        const shark: Shark = {
          id: apiId,
          external_id: externalIdRaw ?? undefined,
          name: row.name ?? `Shark ${externalIdRaw ?? internalId}`,
          species: row.species ?? "Unknown species",
          latitude: Number(latest.lat),
          longitude: Number(latest.lng),
          imageUrl: row.image_url ?? null,
          last_update: latest.time ?? safeIso(row.updated_at),
          track,
        };

        return shark;
      })
      .filter((s): s is Shark => s !== null);

    // 5) Add approximate SST (°C)
    const sharksWithSst = await addApproxSstToSharks(sharks);
    return res.json(sharksWithSst);
  } catch (err: any) {
    console.error("Error in GET /api/sharks:", err);
    return res
      .status(500)
      .json({ error: err?.message ?? "Internal server error" });
  }
});

/**
 * GET /api/sharks/:id/track?hours=24
 *
 * :id can be:
 *   - external_id (numeric-like string, most common)
 *   - OR internal sharks.id (fallback)
 *
 * hours is OPTIONAL: how many hours back to return.
 * If omitted, returns full history.
 */
router.get("/sharks/:id/track", async (req, res) => {
  try {
    const idParam = req.params.id; // could be external_id or internal id
    const hoursRaw = req.query.hours as string | undefined;

    const hours = hoursRaw ? Number(hoursRaw) : null;
    const sinceIso =
      hours != null && Number.isFinite(hours) && hours > 0
        ? new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
        : null;

    // 1) Resolve internal shark id
    // First try external_id match (stored as TEXT)
    let internalId: number | null = null;

    const { data: byExternal, error: extErr } = await supabaseAdmin
      .from("sharks")
      .select("id")
      .eq("external_id", idParam)
      .maybeSingle();

    if (extErr) {
      console.error("Supabase sharks external_id lookup error:", extErr);
      // continue to internal-id fallback
    }

    if (byExternal?.id != null) {
      internalId = Number(byExternal.id);
    } else {
      // fallback: treat param as internal numeric id
      const asNum = Number(idParam);
      if (Number.isFinite(asNum)) {
        const { data: byInternal, error: intErr } = await supabaseAdmin
          .from("sharks")
          .select("id")
          .eq("id", asNum)
          .maybeSingle();

        if (intErr) {
          console.error("Supabase sharks internal id lookup error:", intErr);
        } else if (byInternal?.id != null) {
          internalId = Number(byInternal.id);
        }
      }
    }

    if (!internalId) {
      return res.json([]);
    }

    // 2) Fetch positions (optionally filtered)
    let q = supabaseAdmin
      .from("shark_positions")
      .select("lat, lng, source_timestamp, created_at")
      .eq("shark_id", internalId);

    if (sinceIso) {
      q = q.gte("created_at", sinceIso);
    }

    const { data: positions, error: posError } = await q.order("created_at", {
      ascending: true,
    });

    if (posError) {
      console.error("Supabase shark_positions error:", posError);
      return res.status(500).json({ error: posError.message });
    }

    const result =
      (positions as any[] | null)?.map((row) => ({
        latitude: row.lat,
        longitude: row.lng,
        timestamp: safeIso(row.source_timestamp ?? row.created_at),
      })) ?? [];

    return res.json(result);
  } catch (err: any) {
    console.error("Error in GET /api/sharks/:id/track:", err);
    return res
      .status(500)
      .json({ error: err?.message ?? "Internal server error" });
  }
});

export default router;
