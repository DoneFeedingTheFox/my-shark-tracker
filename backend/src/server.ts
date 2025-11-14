import express from "express";
import cors from "cors";
import sharksRouter from "./sharks";
import { refreshSharkPositions } from "./services/sharkSync";

const app = express();

// Enable CORS for all routes
app.use(cors());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Manual trigger endpoint for the shark sync
app.get("/admin/refresh-sharks", async (_req, res) => {
  try {
    await refreshSharkPositions();
    res.json({ ok: true });
  } catch (err) {
    console.error("refresh-sharks failed", err);
    res
      .status(500)
      .json({ ok: false, error: (err as Error).message ?? "Unknown error" });
  }
});

// Main API routes
app.use("/api", sharksRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
