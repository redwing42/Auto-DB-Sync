// @ts-check

/**
 * @typedef {{ latitude: number, longitude: number }} LatLng
 * @typedef {{ elevations: number[], source: 'ardupilot' | 'open-elevation' | 'none' }} TerrainBatchResult
 */

const OPEN_ELEVATION_URL = 'https://api.open-elevation.com/api/v1/lookup';
const ARDUPILOT_TILE_URL = 'https://terrain.ardupilot.org/tile';

/** @type {Map<string, number>} */
const memoryCache = new Map();

function cacheKey(lat, lon) {
  // 6 decimals ~ 0.11m lat; good enough for terrain overlay caching
  return `${lat.toFixed(6)},${lon.toFixed(6)}`;
}

/**
 * @param {LatLng[]} locations
 * @returns {number[]}
 */
function cachedElevationsOrNaN(locations) {
  return locations.map(({ latitude, longitude }) => {
    const k = cacheKey(latitude, longitude);
    return memoryCache.has(k) ? /** @type {number} */ (memoryCache.get(k)) : NaN;
  });
}

/**
 * @param {LatLng[]} locations
 * @param {number[]} elevations
 */
function writeCache(locations, elevations) {
  for (let i = 0; i < locations.length; i++) {
    const { latitude, longitude } = locations[i];
    const e = elevations[i];
    if (Number.isFinite(e)) memoryCache.set(cacheKey(latitude, longitude), e);
  }
}

/**
 * Try ArduPilot terrain endpoint (best effort).
 * This endpoint is not documented as batch, so we attempt a single call per point ONLY
 * if there is exactly one uncached location. Otherwise we will fall back to Open-Elevation
 * to satisfy the "batch in one request" constraint.
 *
 * @param {LatLng[]} locations
 * @returns {Promise<TerrainBatchResult | null>}
 */
async function tryArduPilot(locations) {
  if (locations.length !== 1) return null;
  const { latitude: lat, longitude: lon } = locations[0];

  const url = `${ARDUPILOT_TILE_URL}?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) return null;

  // The /tile endpoint response format varies; if we can't confidently parse a single numeric elevation,
  // we treat it as unusable and fall back.
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;

  /** @type {any} */
  const data = await res.json();
  const e = typeof data?.elevation === 'number' ? data.elevation : (typeof data === 'number' ? data : NaN);
  if (!Number.isFinite(e)) return null;

  return { elevations: [e], source: 'ardupilot' };
}

/**
 * Batch fetch terrain elevations (metres AMSL) via Open-Elevation.
 * @param {LatLng[]} locations
 * @returns {Promise<TerrainBatchResult>}
 */
async function fetchOpenElevation(locations) {
  const body = JSON.stringify({
    locations: locations.map((l) => ({ latitude: l.latitude, longitude: l.longitude })),
  });

  const res = await fetch(OPEN_ELEVATION_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  if (!res.ok) {
    return { elevations: new Array(locations.length).fill(NaN), source: 'none' };
  }

  /** @type {any} */
  const data = await res.json();
  const results = Array.isArray(data?.results) ? data.results : [];

  // Open-Elevation returns results in request order, but we defensively map by index.
  const elevations = results.map((r) => (typeof r?.elevation === 'number' ? r.elevation : NaN));
  while (elevations.length < locations.length) elevations.push(NaN);

  return { elevations: elevations.slice(0, locations.length), source: 'open-elevation' };
}

/**
 * Fetch terrain elevations for many points in ONE network request (Open-Elevation),
 * with in-memory caching to avoid re-fetch on re-render.
 *
 * @param {LatLng[]} locations
 * @returns {Promise<TerrainBatchResult>}
 */
export async function getTerrainElevations(locations) {
  const cached = cachedElevationsOrNaN(locations);
  const missingIdx = cached
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => !Number.isFinite(v))
    .map(({ i }) => i);

  if (missingIdx.length === 0) {
    return { elevations: cached, source: 'open-elevation' };
  }

  const missing = missingIdx.map((i) => locations[i]);

  try {
    // Best-effort ArduPilot try for the 1-point case; otherwise keep to one-request Open-Elevation.
    const maybeArdu = await tryArduPilot(missing);
    if (maybeArdu) {
      writeCache(missing, maybeArdu.elevations);
      const merged = cachedElevationsOrNaN(locations);
      return { elevations: merged, source: maybeArdu.source };
    }
  } catch {
    // fall through to Open-Elevation
  }

  try {
    const oe = await fetchOpenElevation(missing);
    writeCache(missing, oe.elevations);
    const merged = cachedElevationsOrNaN(locations);
    return { elevations: merged, source: oe.source };
  } catch {
    return { elevations: cached, source: 'none' };
  }
}

