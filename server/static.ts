import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath, {
    setHeaders(res, filePath) {
      // Vite incorpora el hash del contenido en los activos; pueden quedar en
      // caché un año. El HTML debe revalidarse para descubrir cada despliegue.
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable")
      } else if (path.basename(filePath) === "index.html") {
        res.setHeader("Cache-Control", "no-cache")
      }
    },
  }));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache")
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
