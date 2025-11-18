"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// backend/src/server.ts
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const sharks_1 = __importDefault(require("./sharks"));
const sharkSync_1 = require("./services/sharkSync");
const app = (0, express_1.default)();
// Enable CORS for all routes
app.use((0, cors_1.default)());
// Health check
app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});
// Manual trigger endpoint for the shark sync
app.get("/admin/refresh-sharks", async (_req, res) => {
    try {
        await (0, sharkSync_1.refreshSharkPositions)();
        res.json({ ok: true });
    }
    catch (err) {
        console.error("refresh-sharks failed", err);
        res
            .status(500)
            .json({ ok: false, error: err.message ?? "Unknown error" });
    }
});
// Main API routes
app.use("/api", sharks_1.default);
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
});
