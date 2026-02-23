"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// backend/src/sharks.ts
const express_1 = __importDefault(require("express"));
const supabaseAdmin_1 = require("./lib/supabaseAdmin");
const sstClient_1 = require("./lib/sstClient");
const router = express_1.default.Router();
/**
 * Adds approximate SST in °C for each shark using a cached helper.
 * Runs sequentially to avoid rate limiting (429).
 */
async function addApproxSstToSharks(sharks) {
    const out = [];
    for (const s of sharks) {
        try {
            const sst = await (0, sstClient_1.fetchSeaSurfaceTemperature)(s.latitude, s.longitude);
            out.push({ ...s, approxSst: sst ?? null });
        }
        catch {
            out.push({ ...s, approxSst: null });
        }
    }
    return out;
}
function safeIso(value) {
    if (!value)
        return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function pickMostRecentIso(primary, fallback) {
    const primaryIso = safeIso(primary);
    const fallbackIso = safeIso(fallback);
    if (primaryIso && fallbackIso) {
        return new Date(primaryIso).getTime() >= new Date(fallbackIso).getTime()
            ? primaryIso
            : fallbackIso;
    }
    return primaryIso ?? fallbackIso;
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
        const { data: sharkRows, error: sharkError } = await supabaseAdmin_1.supabaseAdmin
            .from("sharks")
            .select("id, external_id, name, species, image_url, updated_at")
            .order("id", { ascending: true });
        if (sharkError) {
            console.error("Supabase sharks error:", sharkError);
            return res.status(500).json({ error: sharkError.message });
        }
        const sharksDb = sharkRows ?? [];
        if (sharksDb.length === 0)
            return res.json([]);
        // 2) Load ALL positions for those sharks (NO TIME RESTRICTION)
        const internalIds = sharksDb.map((s) => s.id);
        const { data: posRows, error: posError } = await supabaseAdmin_1.supabaseAdmin
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
        const trackByShark = new Map();
        for (const row of positions) {
            const sid = row.shark_id;
            const lat = Number(row.lat);
            const lng = Number(row.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng))
                continue;
            const isoTime = pickMostRecentIso(row.source_timestamp, row.created_at);
            if (!isoTime)
                continue;
            const list = trackByShark.get(sid) ?? [];
            list.push({ lat, lng, time: isoTime });
            trackByShark.set(sid, list);
        }
        const getLatest = (track) => track.length ? track[track.length - 1] : null;
        // 4) Build response
        const sharks = sharksDb
            .map((row) => {
            const internalId = Number(row.id);
            const externalIdRaw = row.external_id;
            // external_id is TEXT in your schema; convert if numeric
            const externalIdNum = externalIdRaw != null ? Number(externalIdRaw) : NaN;
            const track = trackByShark.get(internalId) ?? [];
            const latest = getLatest(track);
            if (!latest)
                return null; // cannot place on map if no positions exist
            const apiId = Number.isFinite(externalIdNum) ? externalIdNum : internalId;
            const shark = {
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
            .filter((s) => s !== null);
        // 5) Add approximate SST (°C)
        const sharksWithSst = await addApproxSstToSharks(sharks);
        return res.json(sharksWithSst);
    }
    catch (err) {
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
        const hoursRaw = req.query.hours;
        const hours = hoursRaw ? Number(hoursRaw) : null;
        const sinceIso = hours != null && Number.isFinite(hours) && hours > 0
            ? new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
            : null;
        // 1) Resolve internal shark id
        // First try external_id match (stored as TEXT)
        let internalId = null;
        const { data: byExternal, error: extErr } = await supabaseAdmin_1.supabaseAdmin
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
        }
        else {
            // fallback: treat param as internal numeric id
            const asNum = Number(idParam);
            if (Number.isFinite(asNum)) {
                const { data: byInternal, error: intErr } = await supabaseAdmin_1.supabaseAdmin
                    .from("sharks")
                    .select("id")
                    .eq("id", asNum)
                    .maybeSingle();
                if (intErr) {
                    console.error("Supabase sharks internal id lookup error:", intErr);
                }
                else if (byInternal?.id != null) {
                    internalId = Number(byInternal.id);
                }
            }
        }
        if (!internalId) {
            return res.json([]);
        }
        // 2) Fetch positions (optionally filtered)
        let q = supabaseAdmin_1.supabaseAdmin
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
        const result = positions?.map((row) => ({
            latitude: row.lat,
            longitude: row.lng,
            timestamp: pickMostRecentIso(row.source_timestamp, row.created_at),
        })) ?? [];
        return res.json(result);
    }
    catch (err) {
        console.error("Error in GET /api/sharks/:id/track:", err);
        return res
            .status(500)
            .json({ error: err?.message ?? "Internal server error" });
    }
});
exports.default = router;
