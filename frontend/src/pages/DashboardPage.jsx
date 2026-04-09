import React, { useState, useEffect } from 'react';
import { api } from '../api/api';
import {
    PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend
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
                <div className="skeleton" style={{ height: '400px', marginTop: '24px' }} />
            </div>
        );
    }

    if (error) return <div className="banner banner-error">⚠ {error}</div>;
    if (!stats) return null;

    const statusData = Object.entries(stats.submission_statuses).map(([k, v]) => ({ name: k, value: v }));

    return (
        <div className="fade-in">
            <div className="page-header">
                <h1>Operations Overview</h1>
            </div>

            {/* Submission Pipeline Cards */}
            <div className="stat-cards">
                <div className="stat-card">
                    <div className="stat-card-value" style={{ color: 'var(--warning)' }}>{stats.submission_statuses.pending || 0}</div>
                    <div className="stat-card-label">Pending Review</div>
                </div>
                <div className="stat-card">
                    <div className="stat-card-value" style={{ color: 'var(--success)' }}>{stats.submission_statuses.approved || 0}</div>
                    <div className="stat-card-label">Total Approved</div>
                </div>
                <div className="stat-card">
                    <div className="stat-card-value" style={{ color: 'var(--danger)' }}>{stats.submission_statuses.rejected || 0}</div>
                    <div className="stat-card-label">Rejected Missions</div>
                </div>
                <div className="stat-card">
                    <div className="stat-card-value" style={{ color: 'var(--text-muted)' }}>{stats.submission_statuses.failed || 0}</div>
                    <div className="stat-card-label">Pipeline Failures</div>
                </div>
            </div>

            <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: '24px', marginTop: '24px' }}>
                <div className="left-col">
                    {/* Team Activity Section */}
                    <TeamActivity />

                    {/* Recent Activity */}
                    {stats.recent_approved.length > 0 && (
                        <div className="card" style={{ marginTop: 24 }}>
                            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                Recently Approved Routes
                            </h3>
                            <div style={{ overflowX: 'auto' }}>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Route</th>
                                            <th>Mission File</th>
                                            <th>Time</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {stats.recent_approved.map(r => (
                                            <tr key={r.id}>
                                                <td className="table-id">{r.human_id || `RW-${r.id.slice(0, 6)}`}</td>
                                                <td className="table-route" style={{ fontSize: '12px' }}>{r.route}</td>
                                                <td className="table-meta">{r.mission_file}</td>
                                                <td className="table-meta">{new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

                <div className="right-col">
                    {/* Submission Status Pie */}
                    {statusData.length > 0 && (
                        <div className="card">
                            <div className="chart-title" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 20, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                Status Distribution
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
                                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    )}

                    {/* Quick Info Card */}
                    <div className="card" style={{ marginTop: '24px', background: 'var(--surface-alt)', border: '1px dashed var(--border-strong)' }}>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px' }}>SYSTEM HEALTH</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--success)', fontWeight: 600 }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor' }} />
                            All Systems Nominal
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
