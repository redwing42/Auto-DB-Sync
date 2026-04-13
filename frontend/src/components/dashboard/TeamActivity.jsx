import React, { useState, useEffect } from 'react';
import { api } from '../../api/api';

export default function TeamActivity() {
    const [stats, setStats] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.getTeamActivity()
            .then(setStats)
            .catch(err => console.error('Failed to load team activity:', err))
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="card" style={{ marginTop: '24px' }}>
                <div className="skeleton" style={{ height: '24px', width: '200px', marginBottom: '16px' }} />
                <div className="skeleton" style={{ height: '200px', width: '100%' }} />
            </div>
        );
    }

    return (
        <div className="card" style={{ marginTop: '24px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Team Activity (This Week)
            </h3>
            <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Member</th>
                            <th>Role</th>
                            <th style={{ textAlign: 'center' }}>Reviewed</th>
                            <th style={{ textAlign: 'center' }}>Approved</th>
                            <th style={{ textAlign: 'center' }}>Rejected</th>
                            <th style={{ textAlign: 'center' }}>Avg Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        {stats.length === 0 ? (
                            <tr>
                                <td colSpan="6" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                                    No activity recorded this week
                                </td>
                            </tr>
                        ) : (
                            stats.map((row) => (
                                <tr key={row.uid} style={{ cursor: 'default' }}>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <div style={{ 
                                                width: '24px', height: '24px', borderRadius: '50%', background: 'var(--primary-light)', 
                                                color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '10px', fontWeight: 600
                                            }}>
                                                {row.name?.charAt(0).toUpperCase()}
                                            </div>
                                            {row.name}
                                        </div>
                                    </td>
                                    <td>
                                        <span className="status-badge" style={{ background: 'var(--surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                                            {row.role}
                                        </span>
                                    </td>
                                    <td style={{ textAlign: 'center', fontWeight: 500 }}>{row.reviewed}</td>
                                    <td style={{ textAlign: 'center', color: 'var(--success)', fontWeight: 600 }}>{row.approved}</td>
                                    <td style={{ textAlign: 'center', color: 'var(--danger)', fontWeight: 600 }}>{row.rejected}</td>
                                    <td style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                                        {row.avg_review_time_hours ? `${row.avg_review_time_hours.toFixed(1)}h` : '—'}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
