import React, { useMemo, useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, Tooltip as LeafletTooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { api } from '../api/api';
import { Globe, Info, Layers, Clock, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Fix for default marker icons in Leaflet with Vite/Webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const CENTER = [20.5937, 78.9629];
const ZOOM = 5;

const THEME_TILES = {
    light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
};

const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const NETWORK_COLORS = Array.from({ length: 12 }).map(
    (_, i) => `var(--nm-net-${i + 1})`
);

// Auto-fit component
function FitBounds({ routes, disabled }) {
    const map = useMap();
    useEffect(() => {
        if (disabled) return;
        if (!routes || routes.length === 0) return;
        const points = [];
        routes.forEach(r => {
            if (r.start_latitude && r.start_longitude) points.push([r.start_latitude, r.start_longitude]);
            if (r.end_latitude && r.end_longitude) points.push([r.end_latitude, r.end_longitude]);
        });
        if (points.length > 0) {
            const bounds = L.latLngBounds(points);
            map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
        }
    }, [routes, map, disabled]);
    return null;
}

function InteractionTracker({ onInteract }) {
    useMapEvents({
        zoomstart: () => onInteract(),
        dragstart: () => onInteract(),
        movestart: () => onInteract(),
    });
    return null;
}

export default function NetworkMapPage() {
    const navigate = useNavigate();
    const [data, setData] = useState({ route_groups: [], locations: [], landing_zones: [], pending_submissions: [], stats: null });
    const [loading, setLoading] = useState(true);
    const [theme, setTheme] = useState(document.documentElement.getAttribute('data-theme') || 'light');
    const [selectedEntity, setSelectedEntity] = useState(null);
    const [hoveredRouteId, setHoveredRouteId] = useState(null);
    const [showLegend, setShowLegend] = useState(true);
    const [userInteracted, setUserInteracted] = useState(false);
    const [showInactive, setShowInactive] = useState(false); // default: active-only

    // Build network → color index map
    const networkColorMap = useRef({});

    useEffect(() => {
        fetchData();
        const observer = new MutationObserver(() => {
            setTheme(document.documentElement.getAttribute('data-theme') || 'light');
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        return () => observer.disconnect();
    }, []);

    const fetchData = async () => {
        try {
            const res = await api.getNetworkMap();
            setData(res);
            const networks = [...new Set((res.route_groups || []).map(g => g.network_name).filter(Boolean))];
            const colorMap = {};
            networks.forEach((n, i) => { colorMap[n] = i; });
            networkColorMap.current = colorMap;
        } catch (err) {
            console.error('Failed to fetch map data:', err);
        } finally {
            setLoading(false);
        }
    };

    const getGroupColor = (group) => {
        const idx = networkColorMap.current[group.network_name] ?? 0;
        return NETWORK_COLORS[idx % NETWORK_COLORS.length];
    };

    const visibleGroups = useMemo(() => {
        const groups = data.route_groups || [];
        if (showInactive) return groups;
        return groups.filter((g) => (g.routes || []).some((r) => r.status === 'ACTIVE'));
    }, [data.route_groups, showInactive]);

    const filteredGroupRoutes = (group) => {
        const routes = (group && group.routes) ? group.routes : [];
        if (showInactive) return routes;
        return routes.filter((r) => r.status === 'ACTIVE');
    };

    const fitRoutes = useMemo(() => {
        return visibleGroups.map(g => ({
            start_latitude: g.start_latitude,
            start_longitude: g.start_longitude,
            end_latitude: g.end_latitude,
            end_longitude: g.end_longitude,
        }));
    }, [visibleGroups]);

    if (loading) {
        return (
            <div className="app-main no-padding">
                <div className="skeleton" style={{ height: 'calc(100vh - 80px)', width: '100%' }} />
            </div>
        );
    }

    const networkNames = Object.keys(networkColorMap.current);
    const stats = data.stats || { total_active: 0, pair_count: 0, pending_count: 0, last_sync: null };

    return (
        <div className="fade-in" style={{ height: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }}>
            <div className="page-header">
                <div className="flex items-center gap-3">
                    <Globe size={24} />
                    <h1>India Network Map</h1>
                </div>
                <div className="text-sm text-muted flex items-center gap-3">
                    <span>{stats.total_active} active routes</span>
                    <span>·</span>
                    <span>{stats.pair_count} hub-node pairs</span>
                    <span>·</span>
                    <span className={stats.pending_count > 0 ? 'text-warning' : ''}>
                        {stats.pending_count} pending
                    </span>
                    {stats.last_sync && (
                        <>
                            <span>·</span>
                            <span title={stats.last_sync}>
                                Last DB update {new Date(stats.last_sync).toLocaleString()}
                            </span>
                        </>
                    )}
                    <span className="ml-auto nm-toggle">
                        <label className="nm-toggle-label">
                            <input
                                type="checkbox"
                                checked={showInactive}
                                onChange={(e) => setShowInactive(e.target.checked)}
                            />
                            <span>Show inactive routes</span>
                        </label>
                    </span>
                </div>
            </div>

            <div style={{ flexGrow: 1, position: 'relative', overflow: 'hidden' }}>
                <MapContainer 
                    center={CENTER} 
                    zoom={ZOOM} 
                    zoomControl={false}
                    style={{ height: '100%', width: '100%', background: 'var(--bg)' }}
                >
                    <TileLayer
                        attribution={ATTRIBUTION}
                        url={THEME_TILES[theme]}
                        key={theme}
                    />
                    <ZoomControl position="bottomright" />
                    <InteractionTracker onInteract={() => setUserInteracted(true)} />
                    <FitBounds routes={fitRoutes} disabled={userInteracted} />

                    {visibleGroups.map((group) => {
                        const groupRoutes = filteredGroupRoutes(group);
                        const color = getGroupColor(group);
                        const isHovered = hoveredRouteId === `${group.hub_location_id}-${group.node_location_id}`;

                        return (
                            <React.Fragment key={`group-${group.hub_location_id}-${group.node_location_id}-${group.network_id || 'net'}`}>
                                <Polyline
                                    positions={[
                                        [group.start_latitude, group.start_longitude],
                                        [group.end_latitude, group.end_longitude],
                                    ]}
                                    pathOptions={{
                                        color,
                                        weight: isHovered ? 6 : 4,
                                        opacity: 0.85,
                                    }}
                                    eventHandlers={{
                                        click: () => setSelectedEntity({ type: 'route-group', group, _color: color }),
                                        mouseover: () => setHoveredRouteId(`${group.hub_location_id}-${group.node_location_id}`),
                                        mouseout: () => setHoveredRouteId(null),
                                    }}
                                >
                                    <LeafletTooltip sticky className="custom-leaflet-tooltip">
                                        <div className="nm-tooltip custom-scrollbar">
                                            <div className="nm-tooltip-header">
                                                <div className="nm-tooltip-title">
                                                    {(group.hub_location_name || 'Hub')} ↔ {(group.node_location_name || 'Node')}
                                                </div>
                                                <span className="nm-tooltip-count">
                                                    {groupRoutes.length} routes
                                                </span>
                                            </div>
                                            <div className="nm-tooltip-network">
                                                <span className="nm-tooltip-dot" style={{ background: color }} />
                                                <span>{group.network_name || 'Unknown network'}</span>
                                            </div>
                                            <div className="nm-tooltip-list">
                                                {groupRoutes.map((r) => (
                                                    <div key={r.id} className="nm-tooltip-row">
                                                        <div className="nm-tooltip-left">
                                                            <span className="nm-tooltip-arrow">
                                                                {r.direction === 'HUB_TO_NODE' ? '→' : '←'}
                                                            </span>
                                                            <span className="nm-tooltip-route">
                                                                {r.start_lz_name} → {r.end_lz_name}
                                                            </span>
                                                        </div>
                                                        <div className="nm-tooltip-right">
                                                            <span className="nm-tooltip-file mono" title={r.mission_filename}>
                                                                {r.mission_filename?.length > 30
                                                                    ? `${r.mission_filename.slice(0, 27)}…`
                                                                    : r.mission_filename}
                                                            </span>
                                                            <span className={`status-badge ${r.status === 'ACTIVE' ? 'status-approved' : 'status-rejected'}`}>
                                                                {r.status}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </LeafletTooltip>
                                </Polyline>

                                <CircleMarker
                                    center={[group.start_latitude, group.start_longitude]}
                                    radius={5}
                                    pathOptions={{ fillColor: color, color: color, weight: 2, fillOpacity: 1 }}
                                />
                                <CircleMarker
                                    center={[group.end_latitude, group.end_longitude]}
                                    radius={5}
                                    pathOptions={{ fillColor: color, color: color, weight: 2, fillOpacity: 1 }}
                                />
                            </React.Fragment>
                        );
                    })}

                    {/* Pending Submissions */}
                    {data.pending_submissions.map((sub) => (
                        <Polyline 
                            key={`pending-${sub.id}`}
                            positions={[
                                [sub.start_latitude, sub.start_longitude],
                                [sub.end_latitude, sub.end_longitude]
                            ]}
                            pathOptions={{ 
                                color: 'var(--warning)', 
                                weight: 3, 
                                opacity: 0.8,
                                dashArray: '6, 8'
                            }}
                            eventHandlers={{
                                click: () => setSelectedEntity({ type: 'pending', ...sub })
                            }}
                        >
                            <LeafletTooltip sticky>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Clock size={12} />
                                    <strong>PENDING: {sub.route}</strong>
                                </div>
                                <span style={{ fontSize: '10px' }}>Submitted by {sub.submitted_by}</span>
                            </LeafletTooltip>
                        </Polyline>
                    ))}
                </MapContainer>

                {/* Map Legend — bottom left */}
                {networkNames.length > 0 && (
                    <div style={{
                        position: 'absolute',
                        bottom: '24px',
                        left: '24px',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        padding: showLegend ? '12px 16px' : '8px 12px',
                        zIndex: 1000,
                        fontSize: '12px',
                        maxWidth: '220px',
                    }}>
                        <div 
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', gap: '8px' }}
                            onClick={() => setShowLegend(!showLegend)}
                        >
                            <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Networks</span>
                            {showLegend ? <EyeOff size={14} style={{ color: 'var(--text-muted)' }} /> : <Eye size={14} style={{ color: 'var(--text-muted)' }} />}
                        </div>
                        {showLegend && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                                {networkNames.map((name, i) => (
                                    <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: NETWORK_COLORS[i % NETWORK_COLORS.length], flexShrink: 0 }} />
                                        <span style={{ color: 'var(--text-secondary)' }}>{name}</span>
                                    </div>
                                ))}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', paddingTop: '6px', borderTop: '1px solid var(--border)' }}>
                                    <div style={{ width: '10px', height: '3px', background: 'var(--warning)', borderRadius: '2px', flexShrink: 0 }} />
                                    <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Pending</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Side Info Panel */}
                {selectedEntity && (
                    <div className="fade-in" style={{
                        position: 'absolute',
                        top: '24px',
                        right: '24px',
                        width: '320px',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        padding: '20px',
                        zIndex: 1000,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.2)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                            <div>
                                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                    {selectedEntity.type === 'route'
                                        ? 'Active Route'
                                        : selectedEntity.type === 'route-group'
                                            ? 'Hub ↔ Node Pair'
                                            : selectedEntity.type === 'pending'
                                                ? 'Pending Submission'
                                                : 'Location Details'}
                                </div>
                                <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text)' }}>
                                    {selectedEntity.type === 'route-group'
                                        ? `${selectedEntity.group?.hub_location_name || 'Hub'} ↔ ${selectedEntity.group?.node_location_name || 'Node'}`
                                        : selectedEntity.type === 'lz'
                                            ? selectedEntity.name
                                            : selectedEntity.route || `${selectedEntity.start_location_name} → ${selectedEntity.end_location_name}`}
                                </h3>
                            </div>
                            <button 
                                onClick={() => setSelectedEntity(null)}
                                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px' }}
                            >
                                ✕
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {selectedEntity.type === 'route-group' && (
                                <>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: selectedEntity._color || 'var(--primary)', flexShrink: 0 }} />
                                        <span style={{ fontWeight: 600 }}>{selectedEntity.group?.network_name || '—'}</span>
                                    </div>
                                    <div className="nm-panel-title">
                                        {(selectedEntity.group?.hub_location_name || 'Hub')} ↔ {(selectedEntity.group?.node_location_name || 'Node')}
                                    </div>
                                    <div className="nm-panel-meta">
                                        {selectedEntity.group?.routes?.length || 0} routes in this pair
                                    </div>

                                    <div className="nm-panel-list custom-scrollbar">
                                        {filteredGroupRoutes(selectedEntity.group).map((r) => (
                                            <div key={r.id} className="nm-panel-card">
                                                <div className="nm-panel-card-top">
                                                    <div className="nm-panel-card-route">
                                                        <span className="nm-tooltip-arrow">
                                                            {r.direction === 'HUB_TO_NODE' ? '→' : '←'}
                                                        </span>
                                                        <span>
                                                            {r.start_lz_name} → {r.end_lz_name}
                                                        </span>
                                                    </div>
                                                    <span className={`status-badge ${r.status === 'ACTIVE' ? 'status-approved' : 'status-rejected'}`}>
                                                        {r.status}
                                                    </span>
                                                </div>
                                                <div className="nm-panel-card-sub">
                                                    <span className="mono" title={r.mission_filename}>{r.mission_filename || '—'}</span>
                                                </div>
                                                <div className="nm-panel-card-sub">
                                                    Last approved: {r.last_updated_by || '—'} {r.last_updated ? `· ${new Date(r.last_updated).toLocaleString()}` : ''}
                                                </div>
                                                {r.latest_submission_id && (
                                                    <button
                                                        className="btn btn-sm btn-primary"
                                                        onClick={() => navigate(`/submissions/${r.latest_submission_id}`)}
                                                    >
                                                        <ExternalLink size={14} />
                                                        View Submission
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                            {selectedEntity.type === 'route' && (
                                <>
                                    {/* Network with color dot */}
                                    {selectedEntity.network_name && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: selectedEntity._color || 'var(--primary)', flexShrink: 0 }} />
                                            <span style={{ fontWeight: 600 }}>{selectedEntity.network_name}</span>
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        <Layers size={14} />
                                        <span>From: <strong style={{ color: 'var(--text)' }}>{selectedEntity.start_lz_name || '—'}</strong></span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        <Layers size={14} />
                                        <span>To: <strong style={{ color: 'var(--text)' }}>{selectedEntity.end_lz_name || '—'}</strong></span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        <Info size={14} />
                                        <span>File: {selectedEntity.mission_filename || '—'}</span>
                                    </div>
                                    {/* Status */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                                        <span className={`status-badge ${selectedEntity.status ? 'status-approved' : 'status-rejected'}`}>
                                            {selectedEntity.status ? 'Active' : 'Inactive'}
                                        </span>
                                    </div>
                                    {/* Waypoint count if available */}
                                    {selectedEntity.waypoint_count != null && (
                                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                            Waypoints: {selectedEntity.waypoint_count}
                                        </div>
                                    )}
                                </>
                            )}
                            {selectedEntity.type === 'pending' && (
                                <>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        <Clock size={14} />
                                        <span>Submitted: {new Date(selectedEntity.created_at).toLocaleDateString()}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        <Info size={14} />
                                        <span>By: {selectedEntity.submitted_by}</span>
                                    </div>
                                    <button 
                                        className="btn btn-sm btn-primary"
                                        onClick={() => navigate(`/submissions/${selectedEntity.id}`)}
                                        style={{ marginTop: '8px' }}
                                    >
                                        <ExternalLink size={14} />
                                        View Submission
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
