import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CesiumViewer from '../waypoint/CesiumViewer';
import WaypointTable from '../waypoint/WaypointTable';
import ElevationGraph from '../waypoint/ElevationGraph';
import { FileDown, AlertTriangle } from 'lucide-react';
import { useHoveredWaypoint } from '../../context/HoveredWaypointContext';

export default function WaypointViewerTab({ waypoints, sub, verification, setVerification }) {
    const { hoveredWaypointIndex, setHoveredWaypointIndex } = useHoveredWaypoint();
    const [showWaypointTable, setShowWaypointTable] = useState(false);
    const navigate = useNavigate();
    const mapStorageKey = 'rw_waypoint_map_height_v1';
    const graphStorageKey = 'rw_waypoint_graph_height_v1';
    const [mapHeight, setMapHeight] = useState(() => {
        const v = Number(localStorage.getItem(mapStorageKey));
        return Number.isFinite(v) && v >= 580 ? v : 640;
    });
    const [graphHeight, setGraphHeight] = useState(() => {
        const v = Number(localStorage.getItem(graphStorageKey));
        return Number.isFinite(v) && v >= 280 ? v : 320;
    });
    const segmentLabelsKey = 'rw_waypoint_segment_labels_v1';
    const [showSegmentLabels, setShowSegmentLabels] = useState(() => {
        const raw = localStorage.getItem(segmentLabelsKey);
        return raw === null ? true : raw === 'true';
    });

    useEffect(() => {
        try { localStorage.setItem(mapStorageKey, String(mapHeight)); } catch { /* ignore */ }
    }, [mapHeight]);
    useEffect(() => {
        try { localStorage.setItem(graphStorageKey, String(graphHeight)); } catch { /* ignore */ }
    }, [graphHeight]);
    useEffect(() => {
        try { localStorage.setItem(segmentLabelsKey, String(showSegmentLabels)); } catch { /* ignore */ }
    }, [showSegmentLabels]);

    const dragRef = useRef(/** @type {null | { kind: 'map' | 'graph', startY: number, startH: number }} */(null));

    useEffect(() => {
        const onMove = (e) => {
            if (!dragRef.current) return;
            const dy = e.clientY - dragRef.current.startY;
            const next = dragRef.current.startH + dy;
            if (dragRef.current.kind === 'map') setMapHeight(Math.max(580, Math.min(1000, next)));
            else setGraphHeight(Math.max(280, Math.min(600, next)));
        };
        const onUp = () => { dragRef.current = null; };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, []);

    const startDrag = (kind) => (e) => {
        e.preventDefault();
        dragRef.current = { kind, startY: e.clientY, startH: kind === 'map' ? mapHeight : graphHeight };
    };

    const filesDownloaded = sub?.files_downloaded === true || sub?.download_status === 'completed';

    if (!filesDownloaded) {
        return (
            <div className="empty-state" style={{ minHeight: '400px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                <FileDown size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
                <h3 style={{ marginBottom: '8px' }}>Files Not Downloaded</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', maxWidth: '400px', textAlign: 'center' }}>
                    Download the mission waypoints and elevation images first to view the route on the map.
                </p>
                <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => navigate(`/submissions/${sub.id}?tab=files`)}
                >
                    Go to Files tab →
                </button>
            </div>
        );
    }

    if (!waypoints) {
        return (
            <div className="empty-state" style={{ minHeight: '400px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                <AlertTriangle size={48} style={{ color: 'var(--danger)', marginBottom: '16px' }} />
                <h3 style={{ marginBottom: '8px' }}>Waypoint Data Missing</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', maxWidth: '400px', textAlign: 'center' }}>
                    Files were downloaded but the waypoint data could not be parsed or loaded.
                    Try reloading the page.
                </p>
            </div>
        );
    }

    const wps = waypoints.waypoints || [];

    const v = verification || {};
    const setV = setVerification;

    return (
        <div className="wp-viewer-stack" style={{ paddingLeft: 16, paddingRight: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                <label className="wp-table-toggle-label" style={{ marginTop: 0 }}>
                    <input
                        type="checkbox"
                        checked={showSegmentLabels}
                        onChange={(e) => setShowSegmentLabels(e.target.checked)}
                    />
                    Segment Labels
                </label>
            </div>
            <div className="wp-viewer-cesium-wrap">
                <CesiumViewer
                    waypoints={wps}
                    hoveredIndex={hoveredWaypointIndex}
                    onHover={setHoveredWaypointIndex}
                    heightPx={mapHeight}
                    showSegmentLabels={showSegmentLabels}
                />
            </div>

            <div
                className="wp-resize-handle"
                role="separator"
                aria-label="Resize map"
                onMouseDown={startDrag('map')}
            />

            <div className="card mb-24" style={{ marginTop: 0, width: '100%', minHeight: 500, padding: '8px 8px 0' }}>
                <ElevationGraph
                    waypoints={wps}
                    heightPx={500}
                    hoveredIndex={hoveredWaypointIndex}
                    onHover={setHoveredWaypointIndex}
                />
            </div>

            <div
                className="wp-resize-handle"
                role="separator"
                aria-label="Resize graph"
                onMouseDown={startDrag('graph')}
            />

            <label className="wp-table-toggle-label">
                <input
                    type="checkbox"
                    checked={showWaypointTable}
                    onChange={(e) => {
                        const next = e.target.checked;
                        setShowWaypointTable(next);
                        if (next && setV) {
                            setV((prev) => ({ ...(prev || {}), tableReviewed: true }));
                        }
                    }}
                />
                Show waypoint command table
            </label>

            {showWaypointTable && (
                <div className="wp-viewer-table-wrap">
                    <WaypointTable
                        waypoints={wps}
                        hoveredIndex={hoveredWaypointIndex}
                        onHover={setHoveredWaypointIndex}
                    />
                </div>
            )}

            <div className="card" style={{ marginTop: 8 }}>
                <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 14, fontWeight: 700 }}>Waypoint verification checklist</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={!!v.mapReviewed}
                            onChange={(e) => setV?.((prev) => ({ ...(prev || {}), mapReviewed: e.target.checked }))}
                            style={{ width: 16, height: 16 }}
                        />
                        <span>Map (Cesium): route shape + markers look correct</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={!!v.elevationReviewed}
                            onChange={(e) => setV?.((prev) => ({ ...(prev || {}), elevationReviewed: e.target.checked }))}
                            style={{ width: 16, height: 16 }}
                        />
                        <span>Elevation graph: profile looks plausible (no obvious spikes / flats)</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={!!v.tableReviewed}
                            onChange={(e) => setV?.((prev) => ({ ...(prev || {}), tableReviewed: e.target.checked }))}
                            style={{ width: 16, height: 16 }}
                        />
                        <span>Waypoint table: spot-checked commands / frames / lat-lng</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={!!v.filesReviewed}
                            onChange={(e) => setV?.((prev) => ({ ...(prev || {}), filesReviewed: e.target.checked }))}
                            style={{ width: 16, height: 16 }}
                        />
                        <span>Files: mission + images downloaded / links accessible</span>
                    </label>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                    {sub?.payload?.mission_drive_link && (
                        <a className="btn btn-secondary" href={sub.payload.mission_drive_link} target="_blank" rel="noreferrer">
                            Open mission link ↗
                        </a>
                    )}
                    {sub?.payload?.elevation_image_drive_link && (
                        <a className="btn btn-secondary" href={sub.payload.elevation_image_drive_link} target="_blank" rel="noreferrer">
                            Open elevation image ↗
                        </a>
                    )}
                    {sub?.payload?.route_image_drive_link && (
                        <a className="btn btn-secondary" href={sub.payload.route_image_drive_link} target="_blank" rel="noreferrer">
                            Open route image ↗
                        </a>
                    )}
                    <button type="button" className="btn" onClick={() => navigate(`/submissions/${sub.id}?tab=files`)}>
                        Go to Files tab
                    </button>
                </div>
            </div>
        </div>
    );
}
