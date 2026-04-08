import React, { useState, useEffect } from 'react';
import { api } from '../api/api';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend,
} from 'recharts';
import TeamActivity from '../components/dashboard/TeamActivity';

const PIE_COLORS = {
    pending: 'var(--warning)',
    approved: 'var(--success)',
    rejected: 'var(--danger)',
    failed: 'var(--danger)',
    duplicate: 'var(--muted)',
};

export default function DashboardPage() {
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
                <div className="charts-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div className="skeleton" style={{ height: '300px' }} />
                    <div className="skeleton" style={{ height: '300px' }} />
                </div>
            </div>
        );
    }

    if (error) return <div className="banner banner-error">⚠ {error}</div>;
    if (!stats) return null;

    const statusData = Object.entries(stats.submission_statuses).map(([k, v]) => ({ name: k, value: v }));

    return (
        <div className="fade-in">
            <div className="page-header">
                <h1>Overview</h1>
            </div>

            {/* Stat Cards */}
            <div className="stat-cards">
                <div className="stat-card">
                    <div className="stat-card-value">{stats.total_routes}</div>
                    <div className="stat-card-label">Total Routes</div>
                </div>
                <div className="stat-card">
                    <div className="stat-card-value">{stats.active_routes}</div>
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

            {/* Charts */}
            <div className="charts-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
                {/* Routes per Network */}
                {stats.routes_per_network.length > 0 && (
                    <div className="card">
                        <div className="chart-title" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 20, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Routes per Network
                        </div>
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={stats.routes_per_network}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                                <Tooltip 
                                    contentStyle={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, boxShadow: 'var(--shadow)' }}
                                    itemStyle={{ color: 'var(--primary)', fontWeight: 600 }}
                                />
                                <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {/* Submission Status Pie */}
                {statusData.length > 0 && (
                    <div className="card">
                        <div className="chart-title" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 20, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Submission Statuses
                        </div>
                        <ResponsiveContainer width="100%" height={250}>
                            <PieChart>
                                <Pie
                                    data={statusData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {statusData.map((entry) => (
                                        <Cell key={entry.name} fill={PIE_COLORS[entry.name] || 'var(--muted)'} stroke="none" />
                                    ))}
                                </Pie>
                                <Tooltip 
                                    contentStyle={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, boxShadow: 'var(--shadow)' }}
                                />
                                <Legend verticalAlign="bottom" height={36}/>
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>

            {/* Team Activity Section (New in Phase 5) */}
            <TeamActivity />

            {/* Recent Activity */}
            {stats.recent_approved.length > 0 && (
                <div className="card" style={{ marginTop: 24 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Recent Approved Routes
                    </h3>
                    <div style={{ overflowX: 'auto' }}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Route</th>
                                    <th>Mission File</th>
                                    <th>Approved At</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats.recent_approved.map(r => (
                                    <tr key={r.id}>
                                        <td className="table-id">#{r.id.slice(0, 6)}</td>
                                        <td className="table-route">{r.route}</td>
                                        <td className="table-meta">{r.mission_file}</td>
                                        <td className="table-meta">{new Date(r.created_at).toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
