// backend/src/sharks.ts
import express from "express";
import fetch from "node-fetch";
import { supabaseAdmin } from "./lib/supabaseAdmin"; // <-- adjust path if needed

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

// tiny helper
function getProp<T extends object, K extends keyof T>(
  obj: T | undefined | null,
  key: K
): T[K] | undefined {
  return obj ? obj[key] : undefined;
}

/**
 * GET /api/sharks
 * Proxies Mapotic and returns the current shark list.
 */
router.get("/sharks", async (_req, res) => {
  try {
    const url = "https://www.mapotic.com/api/v1/maps/3413/pois.geojson/?h=10";

    const response = await fetch(url);
    if (!response.ok) {
      console.error("Mapotic error:", response.status, await response.text());
      return res
        .status(502)
        .json({ error: "Failed to fetch sharks from OCEARCH/Mapotic" });
    }

    const data = (await response.json()) as {
      type: string;
      features: Array<{
        geometry: { type: string; coordinates: [number, number] };
        properties: any;
      }>;
    };

    const sharks: Shark[] = data.features
      // 1) keep only sharks
      .filter((f) => {
        const props = f.properties || {};
        const catName = getProp(props.category_name, "en") as
          | string
          | undefined;
        const species = props.species as string | undefined;
        return (
          catName === "Sharks" ||
          (species && species.toLowerCase().includes("shark"))
        );
      })
      // 2) map to our Shark type
      .map((f) => {
        const props = f.properties || {};
        const [lon, lat] = f.geometry.coordinates;

        const lastMove: string =
          props.last_move_datetime ||
          props.last_update ||
          new Date().toISOString();

        const shark: Shark = {
          // NOTE: this is the external (Mapotic) id
          id: Number(props.id),
          name: props.name ?? "Unnamed shark",
          species: props.species ?? "Unknown shark",
          gender: props.gender ?? undefined,
          stageOfLife: props.stage_of_life ?? undefined,
          length: props.length ?? undefined,
          weight: props.weight ?? undefined,
          lastMove,
          zPing: Boolean(props.zping),
          zPingTime: props.zping_datetime ?? undefined,
          latitude: Number(lat),
          longitude: Number(lon),
          imageUrl: props.image ?? undefined,
        };

        return shark;
      });

    res.json(sharks);
  } catch (error) {
    console.error("Error in /api/sharks:", error);
    res.status(500).json({ error: "Internal server error" });
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
