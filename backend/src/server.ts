import express from "express";
import cors from "cors";
import sharksRouter from "./sharks";

const app = express();

// Enable CORS for all routes
app.use(cors());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", sharksRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
