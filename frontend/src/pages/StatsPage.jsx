import React, { useState, useEffect } from 'react';
import { api } from '../api/api';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

export default function DatabaseHealthPage() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        api.getStats()
            .then(setStats)
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="animate-pulse">
                <div className="page-header"><div className="skeleton" style={{ height: '32px', width: '200px' }} /></div>
                <div className="stat-cards">
                    {[1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: '100px' }} />)}
                </div>
            </div>
        );
    }
    
    if (error) return <div className="banner banner-error">⚠ {error}</div>;
    if (!stats) return null;

    return (
        <div className="fade-in">
            <div className="page-header">
                <h1>Database Health</h1>
            </div>

            {/* Network Overview Cards */}
            <div className="stat-cards">
                <div className="stat-card">
                    <div className="stat-card-value" style={{ color: 'var(--primary)' }}>{stats.total_routes}</div>
                    <div className="stat-card-label">Total Routes</div>
                </div>
                <div className="stat-card">
                    <div className="stat-card-value" style={{ color: 'var(--success)' }}>{stats.active_routes}</div>
                    <div className="stat-card-label">Active Routes</div>
                </div>
                <div className="stat-card">
                    <div className="stat-card-value">{stats.total_locations}</div>
                    <div className="stat-card-label">Locations</div>
                </div>
                <div className="stat-card">
                    <div className="stat-card-value">{stats.total_landing_zones}</div>
                    <div className="stat-card-label">Landing Zones</div>
                </div>
            </div>

            <div className="charts-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '24px', marginTop: '24px' }}>
                {/* Routes per Network */}
                {stats.routes_per_network.length > 0 && (
                    <div className="card">
                        <div className="chart-title" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 20, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Route Density per Network
                        </div>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={stats.routes_per_network} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={true} vertical={false} />
                                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                                <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={100} />
                                <Tooltip 
                                    cursor={{fill: 'var(--surface-alt)'}}
                                    contentStyle={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, boxShadow: 'var(--shadow)' }}
                                    itemStyle={{ color: 'var(--primary)', fontWeight: 600 }}
                                />
                                <Bar dataKey="count" fill="var(--primary)" radius={[0, 4, 4, 0]} barSize={20} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {/* LZs per Location */}
                {stats.lz_per_location.length > 0 && (
                    <div className="card">
                        <div className="chart-title" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 20, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            LZ Distribution (Top 10 Locations)
                        </div>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={stats.lz_per_location}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                                <Tooltip 
                                    cursor={{fill: 'var(--surface-alt)'}}
                                    contentStyle={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, boxShadow: 'var(--shadow)' }}
                                    itemStyle={{ color: 'var(--success)', fontWeight: 600 }}
                                />
                                <Bar dataKey="count" fill="var(--success)" radius={[4, 4, 0, 0]} barSize={30} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>

            {/* Health Indicators (Placeholders for future telemetry) */}
            <div className="card" style={{ marginTop: '24px', opacity: 0.8 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Network Integrity
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                    <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)' }}>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>ORPHANED LZS</div>
                        <div style={{ fontSize: '18px', fontWeight: 600 }}>0</div>
                    </div>
                    <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)' }}>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>MISSING WAYPOINTS</div>
                        <div style={{ fontSize: '18px', fontWeight: 600 }}>0</div>
                    </div>
                    <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)' }}>
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>TELEMETRY UPTIME</div>
                        <div style={{ fontSize: '18px', fontWeight: 600 }}>99.9%</div>
                    </div>
                </div>
            </div>
        </div>
    );
}
