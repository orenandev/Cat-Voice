import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "public", "vendor");

function copy(fromDir, toDir, filter) {
  mkdirSync(toDir, { recursive: true });
  for (const name of readdirSync(fromDir)) {
    if (filter(name)) cpSync(join(fromDir, name), join(toDir, name));
  }
}

copy(join(root, "node_modules", "libarchive.js", "dist"), join(out, "libarchive"), (n) => n === "worker-bundle.js" || n === "libarchive.wasm");
copy(join(root, "node_modules", "ogv", "dist"), join(out, "ogv"), (n) =>
  /^ogv(\.js|-support\.js|-version\.js|-worker-(audio|video)\.js)$/.test(n) ||
  /^ogv-(demuxer-(ogg|webm)|decoder-audio-(vorbis|opus)|decoder-video-(theora|vp8|vp9))-wasm\.(js|wasm)$/.test(n)
);
