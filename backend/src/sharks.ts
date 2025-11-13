// backend/src/sharks.ts
import express from "express";
import fetch from "node-fetch";


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
function getProp<T extends object, K extends keyof T>(obj: T | undefined | null, key: K): T[K] | undefined {
  return obj ? obj[key] : undefined;
}

router.get("/sharks", async (_req, res) => {
  try {
    const url = "https://www.mapotic.com/api/v1/maps/3413/pois.geojson/?h=10";

    const response = await fetch(url);
    if (!response.ok) {
      console.error("Mapotic error:", response.status, await response.text());
      return res.status(502).json({ error: "Failed to fetch sharks from OCEARCH/Mapotic" });
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
        const catName = getProp(props.category_name, "en") as string | undefined;
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

export default router;
