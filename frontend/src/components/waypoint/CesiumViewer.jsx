import React, { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { api } from '../../api/api';
import { getCommandName } from './waypointParser';

function getPinColorForCommand(cmd) {
    switch (cmd) {
        case 22:
            return '#16A34A'; // TAKEOFF
        case 21:
            return '#DC2626'; // LAND
        case 16:
            return '#FFFFFF'; // WAYPOINT
        case 20:
            return '#D97706'; // RTL
        default:
            return '#9CA3AF'; // Other
    }
}

function createWaypointPin(index, color = '#FFFFFF') {
    const canvas = document.createElement('canvas');
    canvas.width = 28;
    canvas.height = 28;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    // outer circle
    ctx.beginPath();
    ctx.arc(14, 14, 12, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 2;
    ctx.stroke();

    // index number
    ctx.fillStyle = '#1E293B';
    ctx.font = 'bold 10px "Barlow", system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index), 14, 14);

    return canvas.toDataURL();
}

function createHeadingArrowIcon() {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    // Triangle pointing up; rotation applied per waypoint billboard.
    ctx.translate(12, 12);
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 8);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fillStyle = '#000000';
    ctx.fill();
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    return canvas.toDataURL();
}

export default function CesiumViewer({ waypoints, hoveredIndex, onHover, heightPx, showSegmentLabels = true }) {
    const containerRef = useRef(null);
    const viewerRef = useRef(null);
    const entitiesRef = useRef({});
    const headingArrowEntitiesRef = useRef([]);
    const segmentLabelsRef = useRef(null);
    const [tokenLoaded, setTokenLoaded] = useState(false);
    const [selectedWpIndex, setSelectedWpIndex] = useState(null);

    const toRad = (d) => (d * Math.PI) / 180;
    const toDeg = (r) => (r * 180) / Math.PI;

    function computeBearing(lat1, lon1, lat2, lon2) {
        const D2R = Math.PI / 180;
        const dLon = (lon2 - lon1) * D2R;
        const y = Math.sin(dLon) * Math.cos(lat2 * D2R);
        const x = Math.cos(lat1 * D2R) * Math.sin(lat2 * D2R) -
                  Math.sin(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.cos(dLon);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    // Great-circle destination point.
    const destinationPoint = (latDeg, lngDeg, bearingDegIn, distanceM) => {
        const R = 6378137; // WGS84 approx
        const brng = toRad(bearingDegIn);
        const lat1 = toRad(latDeg);
        const lon1 = toRad(lngDeg);
        const dr = distanceM / R;

        const sinLat1 = Math.sin(lat1);
        const cosLat1 = Math.cos(lat1);
        const sinDr = Math.sin(dr);
        const cosDr = Math.cos(dr);

        const lat2 = Math.asin(sinLat1 * cosDr + cosLat1 * sinDr * Math.cos(brng));
        const lon2 = lon1 + Math.atan2(
            Math.sin(brng) * sinDr * cosLat1,
            cosDr - sinLat1 * Math.sin(lat2)
        );
        return { lat: toDeg(lat2), lng: ((toDeg(lon2) + 540) % 360) - 180 };
    };

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    const haversineMeters = (lat1, lon1, lat2, lon2) => {
        const R = 6371000;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    const formatDistance = (m) => {
        if (!Number.isFinite(m)) return '—';
        if (m < 1000) return `${Math.round(m)} m`;
        return `${(m / 1000).toFixed(2)} km`;
    };

    const formatAltDelta = (d) => {
        if (!Number.isFinite(d)) return { text: '→ LEVEL', color: '#aaaacc' };
        if (d > 2) return { text: `↑ CLIMB +${Math.round(d)}m`, color: '#00ff88' };
        if (d < -2) return { text: `↓ DESCENT ${Math.round(d)}m`, color: '#ff4444' };
        return { text: '→ LEVEL', color: '#aaaacc' };
    };

    // Load Cesium token once
    useEffect(() => {
        api.getCesiumToken().then(({ token }) => {
            if (token) Cesium.Ion.defaultAccessToken = token;
            setTokenLoaded(true);
        }).catch(() => setTokenLoaded(true));
    }, []);

    // Initialize viewer and plot waypoints
    useEffect(() => {
        if (!tokenLoaded || !containerRef.current || !waypoints?.length) return;

        // Kill existing viewer
        if (viewerRef.current && !viewerRef.current.isDestroyed()) {
            viewerRef.current.destroy();
        }

        const viewer = new Cesium.Viewer(containerRef.current, {
            terrainProvider: new Cesium.EllipsoidTerrainProvider(),
            animation: false,
            timeline: false,
            baseLayerPicker: false,
            fullscreenButton: false,
            homeButton: false,
            sceneModePicker: false,
            navigationHelpButton: false,
            geocoder: false,
            infoBox: false,
            selectionIndicator: false,
        });
        viewerRef.current = viewer;
        entitiesRef.current = {};
        headingArrowEntitiesRef.current = [];
        segmentLabelsRef.current = null;

        // Keep Cesium canvas sized to container (supports drag-resize)
        const ro = new ResizeObserver(() => {
            try {
                if (!viewer.isDestroyed()) viewer.resize();
            } catch {
                // ignore
            }
        });
        ro.observe(containerRef.current);

        const positions = [];
        const validWps = waypoints.filter(wp => !(wp.latitude === 0 && wp.longitude === 0));

        validWps.forEach((wp) => {
            const pos = Cesium.Cartesian3.fromDegrees(wp.longitude, wp.latitude, wp.altitude);
            positions.push(pos);

            const color = getPinColorForCommand(wp.command);
            const pinImage = createWaypointPin(wp.index, color);

            const entity = viewer.entities.add({
                position: pos,
                billboard: new Cesium.BillboardGraphics({
                    image: pinImage,
                    width: 28,
                    height: 28,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    scaleByDistance: undefined,
                    pixelOffset: new Cesium.Cartesian2(0, -14),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                }),
            });
            entity._waypointIndex = wp.index;
            entitiesRef.current[wp.index] = entity;
        });

        // Fixed-size heading arrowheads anchored to marker billboards.
        // Marker render method: Cesium entity billboards, so arrows use the same system.
        const arrowImage = createHeadingArrowIcon();
        for (let i = 0; i < validWps.length; i++) {
            const wp = validWps[i];
            let heading = 0;
            if (i < validWps.length - 1) {
                heading = computeBearing(
                    validWps[i].latitude,
                    validWps[i].longitude,
                    validWps[i + 1].latitude,
                    validWps[i + 1].longitude
                );
            } else if (i > 0) {
                heading = computeBearing(
                    validWps[i - 1].latitude,
                    validWps[i - 1].longitude,
                    validWps[i].latitude,
                    validWps[i].longitude
                );
            }

            const arrowEntity = viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(wp.longitude, wp.latitude, wp.altitude),
                billboard: new Cesium.BillboardGraphics({
                    image: arrowImage,
                    width: 24,
                    height: 24,
                    rotation: Cesium.Math.toRadians(heading),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    pixelOffset: new Cesium.Cartesian2(0, -20),
                    eyeOffset: new Cesium.Cartesian3(0, 0, -500),
                }),
            });
            headingArrowEntitiesRef.current.push(arrowEntity);
        }

        // Segment midpoint stacked labels (LabelCollection)
        if (showSegmentLabels) {
            const segLabels = viewer.scene.primitives.add(new Cesium.LabelCollection());
            segmentLabelsRef.current = segLabels;

            for (let i = 0; i < validWps.length - 1; i++) {
                const a = validWps[i];
                const b = validWps[i + 1];
                const bearing = computeBearing(a.latitude, a.longitude, b.latitude, b.longitude);
                const dist = haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude);
                const deltaAlt = (b.altitude ?? 0) - (a.altitude ?? 0);
                const angle = Number.isFinite(dist) && dist > 0 ? (toDeg(Math.atan(deltaAlt / dist))) : 0;
                const deltaFmt = formatAltDelta(deltaAlt);

                const midLat = (a.latitude + b.latitude) / 2;
                const midLng = (a.longitude + b.longitude) / 2;

                const lines = [
                    `↗ ${Math.round(bearing)}°`,
                    `${formatDistance(dist)}`,
                    `${deltaFmt.text}`,
                    `${Math.abs(deltaAlt) > 2 ? `@ ${Math.abs(angle).toFixed(1)}°` : ''}`.trim(),
                ].filter(Boolean);

                segLabels.add({
                    position: Cesium.Cartesian3.fromDegrees(midLng, midLat, 0),
                    text: lines.join('\n'),
                    font: '13px "Barlow Condensed", "Barlow", system-ui, sans-serif',
                    fillColor: Cesium.Color.fromCssColorString('#F8FAFC'),
                    showBackground: true,
                    backgroundColor: Cesium.Color.fromCssColorString('rgba(7, 7, 12, 0.94)'),
                    backgroundPadding: new Cesium.Cartesian2(12, 10),
                    outlineColor: Cesium.Color.fromCssColorString('#020617'),
                    outlineWidth: 3,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(0, -14),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                });
            }
        }

        // Orange polyline - fixed width, clamped to ground
        if (positions.length > 1) {
            viewer.entities.add({
                polyline: new Cesium.PolylineGraphics({
                    positions,
                    width: 3,
                    material: Cesium.Color.fromCssColorString('#F59E0B'),
                    clampToGround: true,
                }),
            });
        }

        // Fly to centroid
        if (validWps.length > 0) {
            const avgLat = validWps.reduce((s, w) => s + w.latitude, 0) / validWps.length;
            const avgLng = validWps.reduce((s, w) => s + w.longitude, 0) / validWps.length;
            const maxAlt = Math.max(...validWps.map(w => w.altitude));
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(avgLng, avgLat, maxAlt * 3 + 500),
                duration: 1.5,
            });
        }

        // Hover handler
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((movement) => {
            const picked = viewer.scene.pick(movement.endPosition);
            if (Cesium.defined(picked) && picked.id) {
                const idx = picked.id?._waypointIndex;
                if (Number.isFinite(idx)) {
                    onHover?.(idx);
                    return;
                }
            }
            onHover?.(null);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        // Click handler for side panel
        handler.setInputAction((click) => {
            const picked = viewer.scene.pick(click.position);
            if (Cesium.defined(picked) && picked.id) {
                const idx = picked.id?._waypointIndex;
                if (Number.isFinite(idx)) {
                    setSelectedWpIndex(idx);
                    return;
                }
            }
            setSelectedWpIndex(null);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        return () => {
            handler.destroy();
            ro.disconnect();
            if (viewerRef.current && !viewerRef.current.isDestroyed()) {
                viewerRef.current.destroy();
            }
        };
    }, [tokenLoaded, waypoints, showSegmentLabels]);

    // Highlight entity on hover from table
    useEffect(() => {
        Object.entries(entitiesRef.current).forEach(([idx, entity]) => {
            if (!entity.billboard) return;
            if (parseInt(idx, 10) === hoveredIndex) {
                entity.billboard.scale = 1.2;
            } else {
                entity.billboard.scale = 1.0;
            }
        });
    }, [hoveredIndex]);

    // Tooltip
    const [tooltip, setTooltip] = useState(null);

    useEffect(() => {
        if (!viewerRef.current || viewerRef.current.isDestroyed()) return;
        const viewer = viewerRef.current;

        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((movement) => {
            const picked = viewer.scene.pick(movement.endPosition);
            if (Cesium.defined(picked) && picked.id) {
                const idx = picked.id?._waypointIndex;
                if (Number.isFinite(idx)) {
                    const wp = waypoints.find(w => w.index === idx);
                    if (wp) {
                        const rect = containerRef.current.getBoundingClientRect();
                        setTooltip({
                            x: movement.endPosition.x,
                            y: movement.endPosition.y,
                            wp,
                        });
                        return;
                    }
                }
            }
            setTooltip(null);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        return () => handler.destroy();
    }, [tokenLoaded, waypoints]);

    return (
        <div style={{ position: 'relative' }}>
            <div
                ref={containerRef}
                className="cesium-container"
                style={typeof heightPx === 'number' ? { height: `${heightPx}px` } : undefined}
            />
            {tooltip && (
                <div
                    className="wp-tooltip"
                    style={{
                        left: tooltip.x + 16,
                        top: tooltip.y - 20,
                    }}
                >
                    <h4>WP #{tooltip.wp.index}</h4>
                    <div className="wp-tooltip-row">
                        <span>Command</span>
                        <span>{tooltip.wp.command} ({getCommandName(tooltip.wp.command)})</span>
                    </div>
                    <div className="wp-tooltip-row">
                        <span>Lat</span><span>{tooltip.wp.latitude.toFixed(6)}</span>
                    </div>
                    <div className="wp-tooltip-row">
                        <span>Lng</span><span>{tooltip.wp.longitude.toFixed(6)}</span>
                    </div>
                    <div className="wp-tooltip-row">
                        <span>Alt</span><span>{tooltip.wp.altitude}m</span>
                    </div>
                    <div className="wp-tooltip-row">
                        <span>Param1 (Hold)</span><span>{tooltip.wp.param1}s</span>
                    </div>
                    <div className="wp-tooltip-row">
                        <span>Param2 (Accept R)</span><span>{tooltip.wp.param2}m</span>
                    </div>
                    <div className="wp-tooltip-row">
                        <span>AutoContinue</span><span>{tooltip.wp.autocontinue ? 'Yes' : 'No'}</span>
                    </div>
                </div>
            )}

            <WaypointSidePanel
                waypoints={waypoints}
                selectedIndex={selectedWpIndex}
                onClose={() => setSelectedWpIndex(null)}
                bearingDeg={computeBearing}
                haversineMeters={haversineMeters}
                toDeg={toDeg}
            />
        </div>
    );
}

function WaypointSidePanel({ waypoints, selectedIndex, onClose, bearingDeg, haversineMeters, toDeg }) {
    if (selectedIndex === null || selectedIndex === undefined) return null;
    const sorted = [...(waypoints || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const wp = sorted.find((w) => w.index === selectedIndex);
    if (!wp) return null;
    const i = sorted.findIndex((w) => w.index === selectedIndex);
    const next = i >= 0 ? sorted[i + 1] : null;

    const wp0 = sorted.find((w) => w.index === 0) || sorted[0];
    const wp0Alt = wp0?.altitude ?? 0;
    const agl = (wp.altitude ?? 0) - wp0Alt;

    let cum = 0;
    for (let k = 1; k <= i; k++) {
        const a = sorted[k - 1];
        const b = sorted[k];
        if (!a || !b) continue;
        if (a.latitude === 0 && a.longitude === 0) continue;
        if (b.latitude === 0 && b.longitude === 0) continue;
        cum += haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude);
    }

    let heading = null;
    let distToNext = null;
    let deltaAlt = null;
    let angle = null;
    if (next && !(next.latitude === 0 && next.longitude === 0) && !(wp.latitude === 0 && wp.longitude === 0)) {
        heading = bearingDeg(wp.latitude, wp.longitude, next.latitude, next.longitude);
        distToNext = haversineMeters(wp.latitude, wp.longitude, next.latitude, next.longitude);
        deltaAlt = (next.altitude ?? 0) - (wp.altitude ?? 0);
        angle = distToNext > 0 ? toDeg(Math.atan(deltaAlt / distToNext)) : 0;
    }

    const row = (k, v) => (
        <div className="wp-panel-row" key={k}>
            <span className="wp-panel-k">{k}</span>
            <span className="wp-panel-v">{v}</span>
        </div>
    );

    return (
        <div className="wp-panel" onClick={(e) => e.stopPropagation()}>
            <div className="wp-panel-head">
                <div className="wp-panel-title">WP #{wp.index}</div>
                <button type="button" className="wp-panel-close" onClick={onClose}>×</button>
            </div>

            <div className="wp-panel-section">
                {row('Index', String(wp.index))}
                {row('CurrentWP', String(wp.current_wp ?? '—'))}
                {row('Command', `${wp.command} (${getCommandName(wp.command)})`)}
                {row('Coord Frame', `${wp.coord_frame} (${wp.coord_frame_name || '—'})`)}
                {row('Lat', Number.isFinite(wp.latitude) ? wp.latitude.toFixed(6) : '—')}
                {row('Lng', Number.isFinite(wp.longitude) ? wp.longitude.toFixed(6) : '—')}
                {row('Alt (MSL)', `${Number.isFinite(wp.altitude) ? wp.altitude.toFixed(2) : '—'} m`)}
                {row('Alt (AGL)', `${Number.isFinite(agl) ? `${agl >= 0 ? '+' : ''}${agl.toFixed(1)}` : '—'} m`)}
                {row('AutoContinue', wp.autocontinue ? 'Yes' : 'No')}
            </div>

            <div className="wp-panel-divider">PARAMETERS</div>
            <div className="wp-panel-section">
                {row('Param1 (Hold)', `${wp.param1 ?? '—'} s`)}
                {row('Param2 (Accept R)', `${wp.param2 ?? '—'} m`)}
                {row('Param3 (Pass Thru)', `${wp.param3 ?? '—'}`)}
                {row('Param4 (Yaw)', `${wp.param4 ?? '—'}°`)}
            </div>

            <div className="wp-panel-divider">COMPUTED FROM FILE</div>
            <div className="wp-panel-section">
                {row('Heading to next', heading === null ? '—' : `${Math.round(heading)}°`)}
                {row('Distance to next', distToNext === null ? '—' : (distToNext < 1000 ? `${Math.round(distToNext)} m` : `${(distToNext / 1000).toFixed(2)} km`))}
                {row('Alt change', deltaAlt === null ? '—' : `${deltaAlt > 2 ? '↑' : deltaAlt < -2 ? '↓' : '→'} ${deltaAlt > 0 ? '+' : ''}${Math.round(deltaAlt)}m`)}
                {row('Climb angle', angle === null ? '—' : `${Math.abs(angle).toFixed(1)}°`)}
                {row('Cumulative dist', cum < 1000 ? `${Math.round(cum)} m` : `${(cum / 1000).toFixed(2)} km`)}
            </div>
        </div>
    );
}
