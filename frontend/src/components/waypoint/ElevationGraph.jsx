import React from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { getTerrainElevations } from '../../utils/terrainElevation';

function toRad(d) { return (d * Math.PI) / 180; }
function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

export default function ElevationGraph({ waypoints, elevationImageUrl, heightPx = 200, hoveredIndex, onHover }) {
    const [view, setView] = React.useState('graph');
    const storageKey = 'rw_waypoint_elevation_series_v1';
    const [seriesVisible, setSeriesVisible] = React.useState(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return { abs: true, rel: false, terrain: true };
            const parsed = JSON.parse(raw);
            return { abs: parsed?.abs !== false, rel: parsed?.rel === true, terrain: parsed?.terrain !== false };
        } catch {
            return { abs: true, rel: false, terrain: true };
        }
    });
    React.useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(seriesVisible)); } catch {} }, [seriesVisible]);
    const toggle = (k) => setSeriesVisible((p) => ({ ...p, [k]: !p[k] }));

    const validWps = React.useMemo(() => (waypoints || []).filter((wp) => !(wp.latitude === 0 && wp.longitude === 0)), [waypoints]);
    const getWpAlt = (wp) => Number(wp?.alt ?? wp?.altitude ?? wp?.param7 ?? 0);
    const homeAlt = Number(waypoints?.[0]?.alt ?? waypoints?.[0]?.altitude ?? waypoints?.[0]?.param7 ?? 0);

    // STEP 1: x-axis from WP0 = 0 only (no negative domain)
    const waypointData = React.useMemo(() => {
        let cum = 0;
        return validWps.map((wp, i) => {
            if (i > 0) cum += haversineMeters(validWps[i - 1].latitude, validWps[i - 1].longitude, wp.latitude, wp.longitude);
            return {
                index: wp.index,
                seq: i,
                dist_m: i === 0 ? 0 : cum,
                // RED = absolute MSL (raw file altitude), ORANGE = relative AGL (minus WP0/home)
                abs_msl: getWpAlt(wp),
                rel_agl: getWpAlt(wp) - homeAlt,
                latitude: wp.latitude,
                longitude: wp.longitude,
            };
        });
    }, [validWps, homeAlt]);

    // STEP 3: interpolate route every 500m + chunked Open-Elevation
    const routeSamples = React.useMemo(() => {
        if (waypointData.length < 2) return [];
        const samples = [{ latitude: waypointData[0].latitude, longitude: waypointData[0].longitude, dist_m: 0 }];
        for (let i = 0; i < waypointData.length - 1; i++) {
            const a = waypointData[i];
            const b = waypointData[i + 1];
            const segDist = Math.max(0, b.dist_m - a.dist_m);
            const steps = Math.max(1, Math.ceil(segDist / 500));
            for (let s = 1; s <= steps; s++) {
                const t = s / steps;
                samples.push({
                    latitude: a.latitude + t * (b.latitude - a.latitude),
                    longitude: a.longitude + t * (b.longitude - a.longitude),
                    dist_m: a.dist_m + t * segDist,
                });
            }
        }
        return samples;
    }, [waypointData]);

    const [terrainState, setTerrainState] = React.useState({ status: 'idle', source: null });
    const [terrainData, setTerrainData] = React.useState([]);
    const terrainKey = React.useMemo(() => routeSamples.map((s) => `${s.latitude.toFixed(5)},${s.longitude.toFixed(5)}`).join('|'), [routeSamples]);

    React.useEffect(() => {
        if (!terrainKey || routeSamples.length === 0) return;
        let cancelled = false;
        setTerrainState({ status: 'loading', source: null });
        (async () => {
            const locations = routeSamples.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
            const chunks = chunk(locations, 500);
            const elevations = [];
            const fetchChunkWithRetry = async (c, retries = 2) => {
                for (let attempt = 0; attempt <= retries; attempt++) {
                    try {
                        const res = await fetch('https://api.open-elevation.com/api/v1/lookup', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ locations: c }),
                        });
                        if (!res.ok) throw new Error(`open-elevation failed: ${res.status}`);
                        const json = await res.json();
                        const results = Array.isArray(json?.results) ? json.results : [];
                        return results.map((r) => (Number.isFinite(r?.elevation) ? r.elevation : NaN));
                    } catch (e) {
                        if (attempt === retries) throw e;
                        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
                    }
                }
                return new Array(c.length).fill(NaN);
            };
            for (const c of chunks) {
                const chunkElev = await fetchChunkWithRetry(c);
                for (const e of chunkElev) elevations.push(e);
            }
            if (cancelled) return;
            let merged = routeSamples.map((p, i) => ({ dist_m: p.dist_m, terrain_amsl: elevations[i] }));
            const finiteCount = merged.filter((m) => Number.isFinite(m.terrain_amsl)).length;

            // Fallback: if high-res failed badly, at least show waypoint-level terrain.
            if (finiteCount < Math.max(2, Math.floor(routeSamples.length * 0.2))) {
                const wpLoc = waypointData.map((w) => ({ latitude: w.latitude, longitude: w.longitude }));
                const fb = await getTerrainElevations(wpLoc);
                const wpTerrain = waypointData.map((w, i) => ({ dist_m: w.dist_m, terrain_amsl: fb.elevations[i] }));
                const wpFinite = wpTerrain.filter((m) => Number.isFinite(m.terrain_amsl)).length;
                if (wpFinite > 0) {
                    merged = wpTerrain;
                    setTerrainState({ status: 'ready', source: `${fb.source} (fallback)` });
                } else {
                    setTerrainState({ status: 'failed', source: 'none' });
                }
            } else {
                setTerrainState({ status: 'ready', source: 'open-elevation' });
            }
            setTerrainData(merged);
        })().catch(() => {
            if (cancelled) return;
            setTerrainData([]);
            setTerrainState({ status: 'failed', source: 'none' });
        });
        return () => { cancelled = true; };
    }, [terrainKey, routeSamples]);

    if (!waypointData.length && !elevationImageUrl) return null;

    const stats = (arr, key) => {
        const vals = arr.map((d) => d[key]).filter(Number.isFinite);
        if (!vals.length) return null;
        const min = Math.min(...vals), max = Math.max(...vals), mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        return { min, max, mean };
    };
    const pathStats = stats(waypointData, 'abs_msl');
    const demStats = stats(terrainData, 'terrain_amsl');
    const fmt = (v) => `${Math.round(v)}m`;
    const allValues = [
        ...waypointData.map((d) => d.abs_msl),
        ...terrainData.map((d) => d.terrain_amsl),
    ].filter((v) => !Number.isNaN(v) && Number.isFinite(v));
    const yMin = allValues.length ? Math.floor((Math.min(...allValues) - 100) / 100) * 100 : 0;
    const yMax = allValues.length ? Math.ceil((Math.max(...allValues) + 200) / 100) * 100 : 2000;
    const yTickCount = Math.ceil((yMax - yMin) / 200) + 1;
    const hoveredPoint = Number.isFinite(hoveredIndex)
        ? waypointData.find((d) => d.index === hoveredIndex) || null
        : null;
    const maxDist = waypointData.length ? waypointData[waypointData.length - 1].dist_m : 0;
    const labelMinDistance = Math.max(1200, maxDist / 12);
    const labelIndices = React.useMemo(() => {
        const shown = new Set();
        let lastShownDist = -Infinity;
        waypointData.forEach((p, i) => {
            const force = i === 0 || i === waypointData.length - 1 || hoveredPoint?.index === p.index;
            if (force || p.dist_m - lastShownDist >= labelMinDistance) {
                shown.add(p.index);
                lastShownDist = p.dist_m;
            }
        });
        return shown;
    }, [waypointData, labelMinDistance, hoveredPoint]);

    const pillStyle = (active) => ({
        borderRadius: 0,
        padding: '6px 10px',
        border: `1px solid ${active ? '#3b82f6' : 'rgba(136,136,153,0.5)'}`,
        background: active ? '#1f2a44' : 'transparent',
        color: active ? '#f1f5f9' : '#8b93a7',
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: '"JetBrains Mono", monospace',
    });

    const WaypointDot = ({ cx, cy, payload }) => {
        if (typeof cx !== 'number' || typeof cy !== 'number') return null;
        const isHovered = hoveredPoint?.index === payload?.index;
        const showLabel = labelIndices.has(payload?.index);
        return (
            <g onMouseEnter={() => onHover?.(payload?.index ?? null)} onMouseLeave={() => onHover?.(null)}>
                <circle cx={cx} cy={cy} r={isHovered ? 8 : 5} fill={isHovered ? '#ffffff' : '#ff3333'} />
                {showLabel && (
                    <text x={cx} y={cy - 10} fill="#ffffff" fontSize="10" fontFamily='"JetBrains Mono", monospace' textAnchor="middle">
                        {`WP ${payload?.index}`}
                    </text>
                )}
            </g>
        );
    };

    const CustomTooltip = ({ active, label }) => {
        if (!active) return null;
        const dist = Number(label);
        if (!Number.isFinite(dist)) return null;
        const distLabel = dist >= 1000 ? `${(dist / 1000).toFixed(2)} km` : `${dist.toFixed(0)} m`;
        const wpAtX = waypointData.find((d) => Math.abs(d.dist_m - dist) < 1e-6)
            || waypointData.reduce((best, d) => (!best || Math.abs(d.dist_m - dist) < Math.abs(best.dist_m - dist) ? d : best), null);
        const terrainAtX = terrainData.length
            ? terrainData.reduce((best, d) => (!best || Math.abs(d.dist_m - dist) < Math.abs(best.dist_m - dist) ? d : best), null)
            : null;
        const row = (enabled, color, prefix, labelText, value) => (
            <div style={{ color: enabled ? color : '#444455' }}>
                {`${enabled ? prefix : '○'} ${labelText}: ${Number.isFinite(value) ? value.toFixed(0) : '—'} m`}
            </div>
        );
        return (
            <div style={{
                background: 'rgba(10,10,20,0.92)',
                border: '1px solid #1e1e2e',
                padding: '8px 12px',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '12px',
                lineHeight: '1.8',
            }}>
                <div style={{ color: '#888899', marginBottom: 4 }}>
                    Distance: {distLabel}
                </div>
                {row(seriesVisible.abs, '#ff3333', '●', 'Absolute MSL', wpAtX?.abs_msl)}
                {row(seriesVisible.rel, '#ff8800', '●', 'Relative AGL', wpAtX?.rel_agl)}
                {row(seriesVisible.terrain, '#4488ff', '○', 'Terrain AMSL', terrainAtX?.terrain_amsl)}
            </div>
        );
    };

    return (
        <div className="elevation-graph" style={{ background: '#0d1117', borderRadius: 0, boxShadow: 'none' }}>
            {elevationImageUrl && (
                <div className="elevation-tabs">
                    <button className={`tab ${view === 'graph' ? 'active' : ''}`} onClick={() => setView('graph')}>Generated Graph</button>
                    <button className={`tab ${view === 'image' ? 'active' : ''}`} onClick={() => setView('image')}>Provided Image</button>
                </div>
            )}

            {view === 'graph' && waypointData.length > 0 && (
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button type="button" style={pillStyle(seriesVisible.abs)} onClick={() => toggle('abs')}>Absolute MSL</button>
                            <button type="button" style={pillStyle(seriesVisible.rel)} onClick={() => toggle('rel')}>Relative AGL</button>
                            <button type="button" style={pillStyle(seriesVisible.terrain)} onClick={() => toggle('terrain')}>Terrain</button>
                        </div>
                        <div style={{ fontSize: 11, color: '#888899', fontFamily: '"JetBrains Mono", monospace' }}>
                            {terrainState.status === 'loading' && 'Fetching terrain…'}
                            {terrainState.status === 'ready' && `Terrain source: ${terrainState.source}`}
                            {terrainState.status === 'failed' && 'Terrain unavailable'}
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                        <div style={{ background: 'rgba(0,0,0,0.5)', padding: '6px 8px', fontSize: 11, fontFamily: '"JetBrains Mono", monospace' }}>
                            {pathStats && <div style={{ color: '#ff3333' }}>■ Planned Path (Min: {fmt(pathStats.min)} Max: {fmt(pathStats.max)} Mean: {fmt(pathStats.mean)})</div>}
                            {demStats && <div style={{ color: '#4444ff' }}>■ DEM (Min: {fmt(demStats.min)} Max: {fmt(demStats.max)} Mean: {fmt(demStats.mean)})</div>}
                        </div>
                        {hoveredPoint && (
                            <div style={{ background: 'rgba(0,0,0,0.55)', padding: '6px 8px', fontSize: 11, fontFamily: '"JetBrains Mono", monospace', color: '#f8fafc' }}>
                                {`WP ${hoveredPoint.index} | Alt: ${hoveredPoint.abs_msl.toFixed(1)}m | Dist: ${hoveredPoint.dist_m >= 1000 ? `${(hoveredPoint.dist_m / 1000).toFixed(2)}km` : `${Math.round(hoveredPoint.dist_m)}m`}`}
                            </div>
                        )}
                    </div>

                    <div style={{ position: 'relative' }}>
                        <ResponsiveContainer width="100%" height={500}>
                            <ComposedChart data={waypointData} margin={{ top: 20, right: 40, bottom: 24, left: 10 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                                {waypointData.map((d) => (
                                    <ReferenceLine key={`wp-v-${d.index}`} x={d.dist_m} stroke="rgba(255,255,255,0.30)" strokeDasharray="3 3" />
                                ))}
                                {Number.isFinite(hoveredIndex) && waypointData.some((d) => d.index === hoveredIndex) && (
                                    <ReferenceLine x={waypointData.find((d) => d.index === hoveredIndex)?.dist_m} stroke="rgba(255,255,255,0.8)" strokeWidth={2} strokeDasharray="3 3" />
                                )}
                                <XAxis
                                    dataKey="dist_m"
                                    type="number"
                                    domain={[0, (max) => (Number.isFinite(max) ? max + Math.max(500, max * 0.06) : 0)]}
                                    tick={{ fontSize: 11, fill: '#888899', fontFamily: 'JetBrains Mono, monospace' }}
                                    tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`)}
                                    label={{ value: 'Distance (m)', position: 'insideBottom', dy: 14, fill: '#888899', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                                />
                                <YAxis
                                    tick={{ fontSize: 11, fill: '#888899', fontFamily: 'JetBrains Mono, monospace' }}
                                    unit="m"
                                    width={48}
                                    domain={[yMin, yMax]}
                                    tickCount={yTickCount}
                                    label={{ value: 'Elevation (m)', angle: -90, position: 'insideLeft', fill: '#888899', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                                />
                                <Tooltip
                                    content={<CustomTooltip />}
                                    cursor={{ stroke: 'rgba(255,255,255,0.5)', strokeDasharray: '3 3' }}
                                    isAnimationActive={false}
                                />

                                {seriesVisible.terrain && (
                                    <Area
                                        data={terrainData}
                                        type="monotone"
                                        dataKey="terrain_amsl"
                                        stroke="#4444ff"
                                        strokeWidth={1.5}
                                        fill="rgba(0,80,180,0.35)"
                                        connectNulls
                                        dot={false}
                                        isAnimationActive={false}
                                    />
                                )}
                                {seriesVisible.abs && (
                                    <Line
                                        type="linear"
                                        dataKey="abs_msl"
                                        stroke="#ff3333"
                                        strokeWidth={3}
                                        dot={<WaypointDot />}
                                        activeDot={{ r: 8, fill: '#ffffff' }}
                                        isAnimationActive={false}
                                    />
                                )}
                                {seriesVisible.rel && (
                                    <Line
                                        type="linear"
                                        dataKey="rel_agl"
                                        stroke="#ff8800"
                                        strokeWidth={2}
                                        dot={{ r: 4, fill: '#ff8800' }}
                                        isAnimationActive={false}
                                    />
                                )}
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {view === 'image' && elevationImageUrl && (
                <img src={elevationImageUrl} alt="Elevation profile" className="inline-image" />
            )}
        </div>
    );
}
