import React, { useState, useEffect } from 'react';
import { api } from '../api/api';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    Cell, LabelList
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
                    {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="skeleton" style={{ height: '100px' }} />)}
                </div>
            </div>
        );
    }
    
    if (error) return <div className="banner banner-error">⚠ {error}</div>;
    if (!stats) return null;

    const inactiveRoutes = (stats.total_routes || 0) - (stats.active_routes || 0);

    // Sort routes per network descending
    const rpn = [...(stats.routes_per_network || [])].sort((a, b) => (b.count || 0) - (a.count || 0));

    // Sort LZ per location descending, force integer counts
    const lzpl = [...(stats.lz_per_location || [])].sort((a, b) => (b.count || 0) - (a.count || 0));

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
                    <div className="stat-card-value" style={{ color: 'var(--warning)' }}>{inactiveRoutes}</div>
                    <div className="stat-card-label">Inactive Routes</div>
                </div>
                <div className="stat-card">
                    <div className="stat-card-value">{stats.total_networks || rpn.length}</div>
                    <div className="stat-card-label">Total Networks</div>
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
                {/* Routes per Network — horizontal stacked bar */}
                {rpn.length > 0 && (
                    <div className="card">
                        <div className="chart-title" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 20, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Route Density per Network
                        </div>
                        <ResponsiveContainer width="100%" height={Math.max(200, rpn.length * 40)}>
                            <BarChart data={rpn} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={true} vertical={false} />
                                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                                <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={120} />
                                <Tooltip 
                                    cursor={{fill: 'var(--surface-alt)'}}
                                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text)' }}
                                    itemStyle={{ color: 'var(--text)' }}
                                />
                                <Bar dataKey="active" stackId="routes" fill="var(--success)" radius={[0, 0, 0, 0]} barSize={22} name="Active">
                                    <LabelList dataKey="count" position="right" style={{ fill: 'var(--text-secondary)', fontSize: 11, fontWeight: 600 }} />
                                </Bar>
                                <Bar dataKey="inactive" stackId="routes" fill="var(--muted)" radius={[0, 4, 4, 0]} barSize={22} name="Inactive" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {/* LZs per Location — vertical bar */}
                {lzpl.length > 0 && (
                    <div className="card">
                        <div className="chart-title" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 20, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            LZ Distribution (Top 10 Locations)
                        </div>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={lzpl}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} angle={-30} textAnchor="end" height={60} />
                                <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} allowDecimals={false} domain={[0, 'auto']} />
                                <Tooltip 
                                    cursor={{fill: 'var(--surface-alt)'}}
                                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text)' }}
                                    itemStyle={{ color: 'var(--text)' }}
                                />
                                <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} barSize={30} name="LZ Count">
                                    <LabelList dataKey="count" position="top" style={{ fill: 'var(--text-secondary)', fontSize: 11, fontWeight: 600 }} />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>

            {/* Last Updated Section */}
            {(stats.db_last_sync_at || stats.excel_last_modified_at) && (
                <div className="card" style={{ marginTop: '24px' }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Last Updated
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)' }}>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em' }}>Database Last Sync</div>
                            <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text)' }}>
                                {stats.db_last_sync_at ? new Date(stats.db_last_sync_at).toLocaleString() : 'Never'}
                            </div>
                            {stats.db_last_sync_by && (
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                    by {stats.db_last_sync_by}
                                </div>
                            )}
                        </div>
                        <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)' }}>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em' }}>Excel File Modified</div>
                            <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text)' }}>
                                {stats.excel_last_modified_at ? new Date(stats.excel_last_modified_at).toLocaleString() : 'Not available'}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
