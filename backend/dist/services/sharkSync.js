"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshSharkPositions = refreshSharkPositions;
// src/services/sharkSync.ts
const supabaseAdmin_1 = require("../lib/supabaseAdmin");
const POIS_URL = "https://www.mapotic.com/api/v1/maps/3413/pois.geojson/?h=10";
// avoid tiny float noise: 5 decimals ≈ 1m
function roundCoord(value) {
    return Math.round(value * 1e5) / 1e5;
}
async function refreshSharkPositions() {
    // 1) Fetch current positions from Mapotic
    const res = await fetch(POIS_URL);
    if (!res.ok) {
        throw new Error(`Failed to fetch POIs: ${res.status} ${res.statusText}`);
    }
    const geojson = await res.json();
    if (!geojson.features) {
        throw new Error("Unexpected GeoJSON format: no features array");
    }
    let insertedPoints = 0;
    for (const feature of geojson.features) {
        const props = feature.properties || {};
        const coords = feature.geometry?.coordinates;
        if (!coords)
            continue;
        const [lngRaw, latRaw] = coords;
        const lat = roundCoord(latRaw);
        const lng = roundCoord(lngRaw);
        // Decide what to use as stable ID – adjust based on actual payload:
        const externalId = String(props.id ?? props.slug ?? props.name ?? "");
        if (!externalId)
            continue;
        const name = props.name ?? null;
        const species = props.species ?? null;
        const sourceTimestamp = props.last_ping || props.last_update || null;
        // 2) Upsert shark record
        const { data: sharkRow, error: sharkErr } = await supabaseAdmin_1.supabaseAdmin
            .from("sharks")
            .upsert({
            external_id: externalId,
            name,
            species,
            meta: props,
            updated_at: new Date().toISOString(),
        }, { onConflict: "external_id" })
            .select("id")
            .single();
        if (sharkErr || !sharkRow) {
            console.error("Failed to upsert shark", externalId, sharkErr);
            continue;
        }
        const sharkId = sharkRow.id;
        // 3) Get last stored position for this shark
        const { data: lastPos, error: lastErr } = await supabaseAdmin_1.supabaseAdmin
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
        const hasMoved = !lastPos ||
            roundCoord(lastPos.lat) !== lat ||
            roundCoord(lastPos.lng) !== lng;
        // 4) Insert new point only if moved
        if (hasMoved) {
            const { error: insertErr } = await supabaseAdmin_1.supabaseAdmin
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
    console.log(`refreshSharkPositions: inserted ${insertedPoints} new points`);
}
