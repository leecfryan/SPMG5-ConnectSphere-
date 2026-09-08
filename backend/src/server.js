const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

const app = express();
app.use(cors());
app.use(express.json());
dotenv.config();

const PORT = process.env.PORT || 3000;

app.get("/api/health", (req, res) => {
  res.status(200).json({ message: "Server is healthy" });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
