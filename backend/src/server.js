const path = require("node:path");

// Resolved against this file, not the working directory: the .env lives at the
// repo root, so a bare dotenv.config() finds nothing when the server is started
// from backend/ (`npm run dev`). Must also run before anything that reaches
// src/supabase.js - that module throws at import time when SUPABASE_URL /
// SUPABASE_SECRET_KEY are missing.
require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
  quiet: true,
});

const express = require("express");
const cors = require("cors");
const eventsRoutes = require("./routes/events.routes");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/api/health", (req, res) => {
  res.status(200).json({ message: "Server is healthy" });
});

app.use("/api/events", eventsRoutes);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
