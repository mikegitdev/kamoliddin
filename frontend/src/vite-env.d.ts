/// <reference types="vite/client" />

// Map provider configuration (spec §10 [E]): dev defaults are public OSM
// tiles + MapLibre demo glyphs — production MUST set licensed values.
interface ImportMetaEnv {
  /** Licensed raster tile URL template ({z}/{x}/{y}). */
  readonly VITE_MAP_TILES_URL?: string;
  /** Licensed glyph PBF URL template ({fontstack}/{range}) for text layers. */
  readonly VITE_MAP_GLYPHS_URL?: string;
  /** Attribution string of the licensed tile provider. */
  readonly VITE_MAP_ATTRIBUTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Injected by vite.config.ts (`define`): last commit touching frontend/. */
declare const __BUILD_INFO__: { sha: string; date: string; builtAt: string };

// vite.config.ts shells out to git; the one Node API it needs is typed here
// instead of pulling @types/node (whose timer types would leak into src/).
declare module "node:child_process" {
  export function execSync(
    command: string,
    options: { encoding: "utf8"; stdio: ("ignore" | "pipe")[] },
  ): string;
}
