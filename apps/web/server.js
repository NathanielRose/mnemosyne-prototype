const express = require("express");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;
const distPath = path.join(__dirname, "dist");

app.use(express.static(distPath));

app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Serving dist on port ${port}`);
});
