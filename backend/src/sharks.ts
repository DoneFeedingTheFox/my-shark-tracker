// backend/src/sharks.ts
import express from "express";
// import fetch from "node-fetch"; // no longer needed
import { supabaseAdmin } from "./lib/supabaseAdmin";

export interface Shark {
  id: number;
  name: string;
  species: string;
  gender?: string;
  stageOfLife?: string;
  length?: string;
  weight?: string;
  lastMove: string; // ISO string
  zPing?: boolean;
  zPingTime?: string;
  latitude: number;
  longitude: number;
  imageUrl?: string;
}

const router = express.Router();

/**
 * GET /api/sharks
 *
 * Now served from Supabase instead of the external API.
 * Uses:
 *   sharks(id, external_id, name, species, meta, image_url)
 *   shark_positions(shark_id, lat, lng, source_timestamp, created_at)
 */
router.get("/sharks", async (_req, res) => {
  try {
    // 1) Load all sharks (now also selecting image_url)
    const { data: sharkRows, error: sharkErr } = await supabaseAdmin
      .from("sharks")
      .select("id, external_id, name, species, meta, image_url");

    if (sharkErr) {
      console.error("Supabase sharks error:", sharkErr);
      return res
        .status(500)
        .json({ error: sharkErr.message ?? "Failed to load sharks" });
    }

    if (!sharkRows || sharkRows.length === 0) {
      return res.json([]);
    }

    // 2) Load all positions, newest first
    const { data: posRows, error: posErr } = await supabaseAdmin
      .from("shark_positions")
      .select("shark_id, lat, lng, source_timestamp, created_at")
      .order("created_at", { ascending: false });

    if (posErr) {
      console.error("Supabase shark_positions error:", posErr);
      return res
        .status(500)
        .json({ error: posErr.message ?? "Failed to load positions" });
    }

    // Build a map of latest position per shark_id
    const latestPosByShark = new Map<number, any>();
    if (posRows) {
      for (const row of posRows as any[]) {
        if (!latestPosByShark.has(row.shark_id)) {
          // first row per shark_id is the latest because of order desc
          latestPosByShark.set(row.shark_id, row);
        }
      }
    }

    // 3) Combine into API sharks
    const sharks: Shark[] = (sharkRows as any[])
      .map((row) => {
        const latest = latestPosByShark.get(row.id);
        if (!latest) {
          // No position yet; skip this shark (or return with dummy coords if you prefer)
          return null;
        }

        const meta = row.meta || {};

        const lastMoveTimestamp =
          latest.source_timestamp ?? latest.created_at ?? new Date().toISOString();

        // Prefer DB column image_url, fall back to meta.image
        const imageUrlFromDb: string | undefined = row.image_url ?? undefined;
        const imageFromMeta: string | undefined = meta.image ?? undefined;

        const shark: Shark = {
          // Expose external_id as "id" to keep compatibility with frontend
          id: Number(row.external_id),
          name: row.name ?? "Unnamed shark",
          species: row.species ?? "Unknown shark",
          gender: meta.gender ?? undefined,
          stageOfLife: meta.stage_of_life ?? undefined,
          length: meta.length ?? undefined,
          weight: meta.weight ?? undefined,
          lastMove: new Date(lastMoveTimestamp).toISOString(),
          // zPing/zPingTime could also be stored in meta later if you want
          latitude: Number(latest.lat),
          longitude: Number(latest.lng),
          imageUrl: imageUrlFromDb ?? imageFromMeta ?? undefined,
        };

        return shark;
      })
      .filter((s): s is Shark => s !== null);

    return res.json(sharks);
  } catch (error) {
    console.error("Error in /api/sharks (db-based):", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/sharks/:id/track?hours=24
 *
 * :id    = external_id from Mapotic (same as `id` from /api/sharks)
 * hours  = how many hours back (default 24, max 30 days)
 *
 * Uses Supabase tables:
 *   sharks(external_id) -> sharks(id)
 *   shark_positions(shark_id, lat, lng, source_timestamp, created_at)
 */
router.get("/sharks/:id/track", async (req, res) => {
  try {
    const externalId = req.params.id; // Mapotic id as string
    const hoursRaw = req.query.hours as string | undefined;
    const hours = Number(hoursRaw ?? "24");

    const safeHours =
      !Number.isFinite(hours) || hours <= 0
        ? 24
        : Math.min(hours, 24 * 30); // max 30 days

    const sinceIso = new Date(
      Date.now() - safeHours * 60 * 60 * 1000
    ).toISOString();

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

    // 2) get historical positions
    const { data: positions, error: posError } = await supabaseAdmin
      .from("shark_positions")
      .select("lat, lng, source_timestamp, created_at")
      .eq("shark_id", sharkId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true });

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
