// src/services/sharkSync.ts
import { supabaseAdmin } from "../lib/supabaseAdmin";

const POIS_URL = "https://www.mapotic.com/api/v1/maps/3413/pois.geojson/?h=10";

type TrackingProvider = {
  id: string;
  url: string;
};

function getTrackingProviders(): TrackingProvider[] {
  const defaultProviders: TrackingProvider[] = [{ id: "mapotic", url: POIS_URL }];

  const norwayUrl = process.env.NORWAY_TRACKING_GEOJSON_URL?.trim();
  if (norwayUrl) {
    defaultProviders.push({ id: "norway", url: norwayUrl });
  }

  const extraUrlsRaw = process.env.EXTRA_TRACKING_GEOJSON_URLS ?? "";
  const extraProviders = extraUrlsRaw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((url, index) => ({ id: `extra-${index + 1}`, url }));

  return [...defaultProviders, ...extraProviders];
}

// avoid tiny float noise: 5 decimals ≈ 1m
function roundCoord(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

export async function refreshSharkPositions() {
  const providers = getTrackingProviders();
  let insertedPoints = 0;
  let processedFeatures = 0;

  for (const provider of providers) {
    // 1) Fetch current positions from provider feed
    const res = await fetch(provider.url);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch POIs for provider ${provider.id}: ${res.status} ${res.statusText}`
      );
    }

    const geojson = await res.json();
    if (!geojson.features) {
      throw new Error(
        `Unexpected GeoJSON format for provider ${provider.id}: no features array`
      );
    }

    for (const feature of geojson.features) {
      processedFeatures++;
      const props = feature.properties || {};
      const coords = feature.geometry?.coordinates as [number, number] | undefined;

      if (!coords) continue;

      const [lngRaw, latRaw] = coords;
      const lat = roundCoord(latRaw);
      const lng = roundCoord(lngRaw);

      // Decide what to use as stable ID – adjust based on actual payload:
      const sourceId: string = String(props.id ?? props.slug ?? props.name ?? "");
      if (!sourceId) continue;

      const externalId = `${provider.id}:${sourceId}`;

      const name: string | null = props.name ?? null;
      const species: string | null = props.species ?? null;
      const sourceTimestamp: string | null =
        props.last_ping || props.last_update || null;

      // 2) Upsert shark record
      const { data: sharkRow, error: sharkErr } = await supabaseAdmin
        .from("sharks")
        .upsert(
          {
            external_id: externalId,
            name,
            species,
            meta: {
              ...props,
              source_provider: provider.id,
              source_id: sourceId,
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "external_id" }
        )
        .select("id")
        .single();

      if (sharkErr || !sharkRow) {
        console.error("Failed to upsert shark", externalId, sharkErr);
        continue;
      }

      const sharkId = sharkRow.id as number;

      // 3) Get last stored position for this shark
      const { data: lastPos, error: lastErr } = await supabaseAdmin
        .from("shark_positions")
        .select("lat, lng")
        .eq("shark_id", sharkId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastErr) {
        console.error("Failed to fetch last position", sharkId, lastErr);
        continue;
      }

      const hasMoved =
        !lastPos ||
        roundCoord(lastPos.lat) !== lat ||
        roundCoord(lastPos.lng) !== lng;

      // 4) Insert new point only if moved
      if (hasMoved) {
        const { error: insertErr } = await supabaseAdmin
          .from("shark_positions")
          .insert({
            shark_id: sharkId,
            lat,
            lng,
            source_timestamp: sourceTimestamp,
          });

        if (insertErr) {
          console.error("Failed to insert position", sharkId, insertErr);
          continue;
        }

        insertedPoints++;
      }
    }
  }

  console.log(
    `refreshSharkPositions: processed ${processedFeatures} features from ${providers.length} provider(s), inserted ${insertedPoints} new points`
  );
}
