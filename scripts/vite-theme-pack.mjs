// Dev-server mirror of src-tauri/src/theme_pack.rs: serves an optional local
// theme pack at /theme-pack/* and its file list at /theme-pack/index.json.
// The pack directory is gitignored and never copied into the production build.
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const MEDIA_TYPES = {
  otf: "font/otf",
  ttf: "font/ttf",
  woff2: "font/woff2",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
};
const MAX_DEPTH = 2;

async function listFiles(root, dir = root, depth = 1) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && depth < MAX_DEPTH) files.push(...await listFiles(root, path, depth + 1));
    else if (entry.isFile()) files.push(path.slice(root.length + 1).split(sep).join("/"));
  }
  return files.sort();
}

async function resolveFile(root, urlPath) {
  const relative = urlPath.replace(/^\/+/, "");
  if (!relative || /[%\\:]/.test(relative) || relative.split("/").some((part) => !part || part === "." || part === "..")) return null;
  try {
    const [file, realRoot] = await Promise.all([realpath(join(root, relative)), realpath(root)]);
    return file.startsWith(realRoot + sep) && (await stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

export function themePackDevServer(root = process.env.SLUI_THEME_PACK_DIR ?? resolve("theme-pack")) {
  return {
    name: "slui-theme-pack",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/theme-pack", async (req, res) => {
        const urlPath = decodeURI(new URL(req.url ?? "/", "http://localhost").pathname);
        if (urlPath === "/index.json") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(await listFiles(root)));
          return;
        }
        const file = await resolveFile(root, urlPath);
        if (!file) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", MEDIA_TYPES[file.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream");
        res.end(await readFile(file));
      });
    },
  };
}
