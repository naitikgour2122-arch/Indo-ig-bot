// keep_alive.js
const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("✅ Indo Bot Alive — Server Working Fine!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Keep-alive server running on port ${PORT}`);
});
