import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, Tooltip as LeafletTooltip, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import { api } from '../api/api';
import { Globe, Map as MapIcon, Layers, Info, Clock } from 'lucide-react';

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

export default function NetworkMapPage() {
    const [data, setData] = useState({ routes: [], locations: [], landing_zones: [], pending_submissions: [] });
    const [loading, setLoading] = useState(true);
    const [theme, setTheme] = useState(document.documentElement.getAttribute('data-theme') || 'light');
    const [selectedEntity, setSelectedEntity] = useState(null);

    useEffect(() => {
        fetchData();
        
        // Listen for theme changes
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
        } catch (err) {
            console.error('Failed to fetch map data:', err);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div style={{ height: 'calc(100vh - 120px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="skeleton" style={{ height: '100%', width: '100%' }} />
            </div>
        );
    }

    return (
        <div className="fade-in" style={{ height: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }}>
            <div className="page-header" style={{ flexShrink: 0, padding: '16px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Globe size={24} style={{ color: 'var(--primary)' }} />
                    <h1 style={{ margin: 0 }}>India Network Map</h1>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div className="legend-item" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                        <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--success)' }} />
                        <span>Active Routes</span>
                    </div>
                    <div className="legend-item" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                        <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--warning)' }} />
                        <span>Pending (This Week)</span>
                    </div>
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
                    />
                    <ZoomControl position="bottomright" />

                    {/* Active Routes */}
                    {data.routes.map((route, idx) => (
                        <Polyline 
                            key={`route-${route.id}`}
                            positions={[
                                [route.start_latitude, route.start_longitude],
                                [route.end_latitude, route.end_longitude]
                            ]}
                            pathOptions={{ 
                                color: 'var(--success)', 
                                weight: 2, 
                                opacity: 0.6,
                                dashArray: '5, 5'
                            }}
                            eventHandlers={{
                                click: () => setSelectedEntity({ type: 'route', ...route })
                            }}
                        >
                            <LeafletTooltip sticky>
                                <strong>{route.start_location_name} → {route.end_location_name}</strong>
                                <br />
                                <span style={{ fontSize: '10px' }}>{route.mission_filename}</span>
                            </LeafletTooltip>
                        </Polyline>
                    ))}

                    {/* Pending Submissions */}
                    {data.pending_submissions.map((sub, idx) => (
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
                                dashArray: '1, 6'
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

                    {/* Locations / LZs */}
                    {data.landing_zones.map((lz) => (
                        <CircleMarker
                            key={`lz-${lz.id}`}
                            center={[lz.latitude, lz.longitude]}
                            radius={4}
                            pathOptions={{ 
                                fillColor: 'var(--primary)', 
                                color: 'white', 
                                weight: 1, 
                                fillOpacity: 1 
                            }}
                            eventHandlers={{
                                click: () => setSelectedEntity({ type: 'lz', ...lz })
                            }}
                        >
                            <Popup>
                                <div style={{ minWidth: '150px' }}>
                                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 600 }}>LANDING ZONE</div>
                                    <div style={{ fontWeight: 600, fontSize: '14px' }}>{lz.name}</div>
                                    <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{lz.location_name}</div>
                                    <div style={{ marginTop: '8px', fontSize: '10px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                                        {lz.latitude.toFixed(6)}, {lz.longitude.toFixed(6)}
                                    </div>
                                </div>
                            </Popup>
                        </CircleMarker>
                    ))}
                </MapContainer>

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
                        boxShadow: 'var(--shadow-lg)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                            <div>
                                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                    {selectedEntity.type === 'route' ? 'Active Route' : selectedEntity.type === 'pending' ? 'Pending Submission' : 'Location Details'}
                                </div>
                                <h3 style={{ margin: 0, fontSize: '16px' }}>
                                    {selectedEntity.type === 'lz' ? selectedEntity.name : selectedEntity.route || `${selectedEntity.start_location_name} → ${selectedEntity.end_location_name}`}
                                </h3>
                            </div>
                            <button 
                                onClick={() => setSelectedEntity(null)}
                                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                            >
                                ✕
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {selectedEntity.type === 'route' && (
                                <>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        <Info size={14} />
                                        <span>File: {selectedEntity.mission_filename}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        <Layers size={14} />
                                        <span>From: {selectedEntity.start_lz_name}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        <Layers size={14} />
                                        <span>To: {selectedEntity.end_lz_name}</span>
                                    </div>
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
                                    <a href={`/submissions/${selectedEntity.id}`} className="button button-primary" style={{ marginTop: '12px', textAlign: 'center', fontSize: '12px' }}>
                                        View Submission
                                    </a>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
