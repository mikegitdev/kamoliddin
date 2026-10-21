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
