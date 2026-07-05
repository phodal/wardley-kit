import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptsDir, "..");
const previewDir = join(repoRoot, "preview");
const distDir = join(repoRoot, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await mkdir(join(distDir, "assets"), { recursive: true });
await copyFile(join(previewDir, "index.html"), join(distDir, "index.html"));
await copyFile(join(previewDir, "preview.css"), join(distDir, "preview.css"));

await build({
  entryPoints: [join(previewDir, "client.ts")],
  outdir: join(distDir, "assets"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  splitting: true,
  entryNames: "client",
  chunkNames: "chunks/[name]-[hash]",
  sourcemap: true,
  loader: {
    ".owm": "text"
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production")
  }
});

for (const path of await listBuildOutputs(distDir)) {
  const content = await readFile(path, "utf8");
  await writeFile(path, content.replace(/[ \t]+$/gmu, ""), "utf8");
}

console.log(`Wardley preview built: ${distDir}`);

async function listBuildOutputs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listBuildOutputs(path);
    }
    return [path];
  }));
  return files.flat().filter((path) => path.endsWith(".js") || path.endsWith(".js.map"));
}
