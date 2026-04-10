import React, { useState, useEffect } from 'react';
import { api } from '../../api/api';
import RequiresRole from '../shared/RequiresRole';
import { AlertTriangle, Info, Check } from 'lucide-react';

export default function IDResolutionTab({ preview, sub, onReviewed }) {
    const [verifying, setVerifying] = useState(false);
    const [confirmations, setConfirmations] = useState({});

    // Entities that require explicit user confirmation if they are "new"
    const confirmableEntities = [
        { key: 'network', label: 'Network' },
        { key: 'source_location', label: 'Source Location' },
        { key: 'source_lz', label: 'Source LZ' },
        { key: 'destination_location', label: 'Destination Location' },
        { key: 'destination_lz', label: 'Destination LZ' },
    ];

    const newEntities = confirmableEntities.filter(e => preview?.[e.key]?.action === 'new');
    const isReviewed = sub.id_resolution_reviewed;

    // Check if everything is confirmed
    const allConfirmed = newEntities.every(e => confirmations[e.key] === true);

    const handleConfirm = async () => {
        setVerifying(true);
        try {
            await api.updateReviewState(sub.id, {
                id_resolution_reviewed: true
            });
            // Notify parent about confirmations
            onReviewed?.(confirmations);
        } catch (err) {
            alert(err.message);
        } finally {
            setVerifying(false);
        }
    };

    if (!preview) {
        return (
            <div className="empty-state">
                <p>ID resolution data not available yet.</p>
            </div>
        );
    }

    const networkBlocked = preview.network?.action === 'not_found';
    const hasNew = newEntities.length > 0;

    const entities = [
        { label: 'Network', key: 'network', data: preview.network },
        { label: 'Source Location', key: 'source_location', data: preview.source_location },
        { label: 'Source LZ', key: 'source_lz', data: preview.source_lz },
        { label: 'Dest Location', key: 'destination_location', data: preview.destination_location },
        { label: 'Dest LZ', key: 'destination_lz', data: preview.destination_lz },
        { label: 'Waypoint File', key: 'waypoint_file', data: preview.waypoint_file },
        { label: 'Flight Route', key: 'flight_route', data: preview.flight_route },
    ];

    const actionIcon = (action) => {
        if (action === 'existing') return '✅';
        if (action === 'new') return '🆕';
        return '❌';
    };

    const actionClass = (action) => {
        if (action === 'existing') return 'action-existing';
        if (action === 'new') return 'action-new';
        return 'action-error';
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {networkBlocked && (
                <div className="banner banner-error" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <AlertTriangle size={20} />
                    <div>
                        <strong>Network Not Found</strong>
                        <div style={{ fontSize: '13px', opacity: 0.9 }}>
                            The network "{preview.network?.name}" does not exist in the database.
                            Contact a supervisor to add the network before approving.
                        </div>
                    </div>
                </div>
            )}

            {hasNew && !networkBlocked && !isReviewed && (
                <div className="banner banner-warning" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Info size={20} />
                    <div style={{ fontSize: '13px' }}>
                        <strong>New entries detected.</strong> Please review and confirm each new entity below.
                        Confirmed entries will be created in the Master Excel file upon approval.
                    </div>
                </div>
            )}

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="preview-table">
                    <thead>
                        <tr>
                            <th>Entity</th>
                            <th>Name</th>
                            <th>Action</th>
                            <th>Assigned ID</th>
                            {isReviewed && <th>Status</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {entities.map(({ label, key, data }) => (
                            <tr key={label}>
                                <td>{label}</td>
                                <td>{data?.name || '—'}</td>
                                <td>
                                    <span className={`action-badge ${actionClass(data?.action)}`}>
                                        {actionIcon(data?.action)} {data?.action}
                                    </span>
                                </td>
                                <td style={{ fontFamily: 'monospace' }}>{data?.id ?? '—'}</td>
                                {isReviewed && (
                                    <td>
                                        {data?.action === 'new' ? (
                                            <span style={{ color: '#16A34A', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <Check size={14} /> CONFIRMED
                                            </span>
                                        ) : (
                                            <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>MATCHED</span>
                                        )}
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {preview.warnings?.length > 0 && (
                <div className="flex flex-column gap-8">
                    {preview.warnings.map((w, i) => (
                        <div key={i} className="banner banner-warning" style={{ fontSize: '13px', padding: '10px 16px' }}>
                            ⚠ {w}
                        </div>
                    ))}
                </div>
            )}

            {/* CONFIRMATION GATE */}
            {!isReviewed ? (
                <div
                    className="card"
                    style={{
                        background: hasNew ? 'var(--caution-bg)' : 'var(--surface)',
                        border: hasNew ? `1px solid rgba(251, 191, 36, 0.35)` : '1px solid var(--border)'
                    }}
                >
                    <h4 style={{ marginTop: 0, marginBottom: '16px', fontSize: '14px' }}>Approval Confirmation</h4>

                    {hasNew ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                            {newEntities.map(e => (
                                <label key={e.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px' }}>
                                    <input
                                        type="checkbox"
                                        checked={confirmations[e.key] || false}
                                        onChange={ev => setConfirmations(prev => ({ ...prev, [e.key]: ev.target.checked }))}
                                        style={{ width: '16px', height: '16px' }}
                                    />
                                    <span>I confirm that <strong>{preview[e.key].name}</strong> is a new <strong>{e.label}</strong> and should be created.</span>
                                </label>
                            ))}
                        </div>
                    ) : (
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
                            No new entities detected. All locations and landing zones match existing database records.
                        </p>
                    )}

                    <div className="flex" style={{ justifyContent: 'flex-end' }}>
                        <RequiresRole role="operator">
                            <button
                                className={`btn ${allConfirmed ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={handleConfirm}
                                disabled={verifying || networkBlocked || !allConfirmed}
                            >
                                {verifying ? 'Saving...' : 'Confirm & Proceed to Approval'}
                            </button>
                        </RequiresRole>
                    </div>
                </div>
            ) : (
                <div className="banner banner-success" style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', padding: '16px' }}>
                    <RequiresRole role="operator" fallback={<span>✅ ID Resolution Reviewed</span>}>
                        <span>✅ ID Resolution Reviewed & Confirmed</span>
                    </RequiresRole>
                </div>
            )}
        </div>
    );
}
