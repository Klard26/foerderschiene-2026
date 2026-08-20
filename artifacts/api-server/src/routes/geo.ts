import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";

/**
 * Geo proxy — serves the Standortanalyse map and address autocomplete through
 * our own API instead of letting the browser hit external services directly.
 *
 * - `GET /api/geo/tiles/:z/:x/:y` proxies OpenStreetMap raster tiles with an
 *   in-memory LRU cache, so repeated views are served locally ("offline").
 * - `GET /api/geo/search?q=` proxies Photon geocoding and returns normalized
 *   address results (cached briefly).
 *
 * Mounted BEFORE the global API rate limiter (a single map view loads many
 * tiles); it carries its own generous limiter instead.
 */

const router: IRouter = Router();

const geoLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many map requests, please slow down." },
});
router.use("/geo", geoLimiter);

const TILE_USER_AGENT = "Foerderschiene-Gebaeudecheck/1.0 (+https://replit.com)";
const UPSTREAM_TIMEOUT_MS = 8000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/* ----------------------------- Tile proxy ----------------------------- */

const TILE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TILE_MAX_ENTRIES = 2000;
const TILE_SUBDOMAINS = ["a", "b", "c"];

type TileEntry = { buf: Buffer; type: string; ts: number };
const tileCache = new Map<string, TileEntry>();

function tileCacheGet(key: string): TileEntry | undefined {
  const entry = tileCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > TILE_TTL_MS) {
    tileCache.delete(key);
    return undefined;
  }
  // LRU touch: re-insert so it becomes the most-recently used.
  tileCache.delete(key);
  tileCache.set(key, entry);
  return entry;
}

function tileCacheSet(key: string, entry: TileEntry): void {
  tileCache.set(key, entry);
  while (tileCache.size > TILE_MAX_ENTRIES) {
    const oldest = tileCache.keys().next().value;
    if (oldest === undefined) break;
    tileCache.delete(oldest);
  }
}

router.get("/geo/tiles/:z/:x/:y", async (req, res): Promise<void> => {
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);

  const validZ = Number.isInteger(z) && z >= 0 && z <= 19;
  const max = validZ ? 2 ** z : 0;
  const valid =
    validZ &&
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    x < max &&
    y >= 0 &&
    y < max;

  if (!valid) {
    res.status(400).json({ error: "Invalid tile coordinates" });
    return;
  }

  const key = `${z}/${x}/${y}`;
  const cached = tileCacheGet(key);
  if (cached) {
    res.setHeader("Content-Type", cached.type);
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    res.setHeader("X-Tile-Cache", "HIT");
    res.end(cached.buf);
    return;
  }

  const sub = TILE_SUBDOMAINS[(x + y) % TILE_SUBDOMAINS.length];
  const upstream = `https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`;

  try {
    const upstreamRes = await fetchWithTimeout(
      upstream,
      { headers: { "User-Agent": TILE_USER_AGENT } },
      UPSTREAM_TIMEOUT_MS,
    );
    if (!upstreamRes.ok) {
      req.log.warn({ upstream, status: upstreamRes.status }, "tile upstream failed");
      res.status(502).json({ error: "Tile upstream error" });
      return;
    }
    const type = upstreamRes.headers.get("content-type") ?? "image/png";
    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    tileCacheSet(key, { buf, type, ts: Date.now() });

    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    res.setHeader("X-Tile-Cache", "MISS");
    res.end(buf);
  } catch (err) {
    req.log.warn({ err, upstream }, "tile proxy error");
    res.status(502).json({ error: "Tile proxy error" });
  }
});

/* --------------------------- Address search --------------------------- */

interface AddressResult {
  strasse?: string;
  hausnummer?: string;
  plz?: string;
  city?: string;
  lat: number;
  lng: number;
  label: string;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    city?: string;
    district?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    osm_value?: string;
  };
}

function buildLabel(p: PhotonFeature["properties"]): string {
  const streetPart = [p.street ?? p.name, p.housenumber].filter(Boolean).join(" ");
  const cityPart = [p.postcode, p.city ?? p.district].filter(Boolean).join(" ");
  return [streetPart, cityPart].filter(Boolean).join(", ");
}

function toResult(f: PhotonFeature): AddressResult {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  return {
    strasse: p.street ?? (p.osm_value === "residential" ? p.name : undefined),
    hausnummer: p.housenumber,
    plz: p.postcode,
    city: p.city ?? p.district,
    lat,
    lng,
    label: buildLabel(p),
  };
}

const SEARCH_TTL_MS = 10 * 60 * 1000; // 10 min
const SEARCH_MAX_ENTRIES = 500;
type SearchEntry = { ts: number; results: AddressResult[] };
const searchCache = new Map<string, SearchEntry>();

router.get("/geo/search", async (req, res): Promise<void> => {
  const q = String(req.query["q"] ?? "").trim();
  if (q.length < 3) {
    res.json({ results: [] });
    return;
  }
  if (q.length > 200) {
    res.status(400).json({ error: "Query too long", results: [] });
    return;
  }
  const rawLimit = Number(req.query["limit"]);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 10)
    : 6;

  const key = `${limit}:${q.toLowerCase()}`;
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.ts <= SEARCH_TTL_MS) {
    res.setHeader("Cache-Control", "private, max-age=300");
    res.json({ results: cached.results });
    return;
  }

  try {
    const url =
      `https://photon.komoot.io/api/?lang=de&limit=${limit}&lat=51.16&lon=10.45&q=` +
      encodeURIComponent(q);
    const upstreamRes = await fetchWithTimeout(url, {}, UPSTREAM_TIMEOUT_MS);
    if (!upstreamRes.ok) throw new Error(`Photon ${upstreamRes.status}`);
    const json = (await upstreamRes.json()) as { features?: PhotonFeature[] };
    const results = (json.features ?? [])
      .filter(
        (f) =>
          f.properties.countrycode === "DE" ||
          f.properties.country === "Deutschland" ||
          f.properties.country === "Germany",
      )
      .map(toResult)
      .filter((r) => r.label.length > 0);

    searchCache.set(key, { ts: Date.now(), results });
    while (searchCache.size > SEARCH_MAX_ENTRIES) {
      const oldest = searchCache.keys().next().value;
      if (oldest === undefined) break;
      searchCache.delete(oldest);
    }

    res.setHeader("Cache-Control", "private, max-age=300");
    res.json({ results });
  } catch (err) {
    req.log.warn({ err }, "geo search proxy error");
    res.status(502).json({ error: "Address search unavailable", results: [] });
  }
});

export default router;
