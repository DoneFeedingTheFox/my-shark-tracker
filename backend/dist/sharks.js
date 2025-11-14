"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// backend/src/sharks.ts
const express_1 = __importDefault(require("express"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const router = express_1.default.Router();
// tiny helper
function getProp(obj, key) {
    return obj ? obj[key] : undefined;
}
router.get("/sharks", async (_req, res) => {
    try {
        const url = "https://www.mapotic.com/api/v1/maps/3413/pois.geojson/?h=10";
        const response = await (0, node_fetch_1.default)(url);
        if (!response.ok) {
            console.error("Mapotic error:", response.status, await response.text());
            return res.status(502).json({ error: "Failed to fetch sharks from OCEARCH/Mapotic" });
        }
        const data = (await response.json());
        const sharks = data.features
            // 1) keep only sharks
            .filter((f) => {
            const props = f.properties || {};
            const catName = getProp(props.category_name, "en");
            const species = props.species;
            return (catName === "Sharks" ||
                (species && species.toLowerCase().includes("shark")));
        })
            // 2) map to our Shark type
            .map((f) => {
            const props = f.properties || {};
            const [lon, lat] = f.geometry.coordinates;
            const lastMove = props.last_move_datetime ||
                props.last_update ||
                new Date().toISOString();
            const shark = {
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
    }
    catch (error) {
        console.error("Error in /api/sharks:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
exports.default = router;
