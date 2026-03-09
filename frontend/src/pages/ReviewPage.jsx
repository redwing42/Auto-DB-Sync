import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import CesiumViewer from '../components/CesiumViewer';

const STATUS_COLORS = {
    pending: '#f59e0b', approved: '#10b981', rejected: '#ef4444', failed: '#dc2626', duplicate: '#6b7280',
};

export default function ReviewPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [sub, setSub] = useState(null);
    const [preview, setPreview] = useState(null);
    const [waypoints, setWaypoints] = useState(null);
    const [loading, setLoading] = useState(true);
    const [downloading, setDownloading] = useState(false);
    const [approving, setApproving] = useState(false);
    const [error, setError] = useState(null);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmations, setConfirmations] = useState({
        source_location: false, source_lz: false,
        destination_location: false, destination_lz: false,
    });
    const [rejectReason, setRejectReason] = useState('');
    const [showRejectModal, setShowRejectModal] = useState(false);

    useEffect(() => {
        loadSubmission();
    }, [id]);

    const loadSubmission = async () => {
        setLoading(true);
        try {
            const data = await api.getSubmission(id);
            setSub(data);
            // Auto-load preview
            try { const p = await api.getResolvePreview(id); setPreview(p); } catch { }
            // Auto-load waypoints if downloaded
            if (data.download_status === 'completed') {
                try { const w = await api.getWaypointData(id); setWaypoints(w); } catch { }
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = async () => {
        setDownloading(true);
        setError(null);
        try {
            await api.downloadFiles(id);
            await loadSubmission();
        } catch (err) {
            setError(err.message);
        } finally {
            setDownloading(false);
        }
    };

    const handleApprove = async () => {
        // Check if new entities need confirmation
        if (preview) {
            const needsConfirm = ['source_location', 'source_lz', 'destination_location', 'destination_lz']
                .some(k => preview[k]?.action === 'new');
            if (needsConfirm) {
                setShowConfirmModal(true);
                return;
            }
        }
        await executeApproval();
    };

    const executeApproval = async () => {
        setApproving(true);
        setError(null);
        setShowConfirmModal(false);
        try {
            await api.approveSubmission(id, confirmations);
            await loadSubmission();
        } catch (err) {
            setError(err.message);
        } finally {
            setApproving(false);
        }
    };

    const handleReject = async () => {
        try {
            await api.rejectSubmission(id, rejectReason);
            setShowRejectModal(false);
            await loadSubmission();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleMarkDuplicate = async () => {
        if (!window.confirm("Are you sure you want to mark this as a duplicate?")) return;
        try {
            await api.markAsDuplicate(id);
            await loadSubmission();
        } catch (err) {
            setError(err.message);
        }
    };

    if (loading) return <div className="loading">Loading submission...</div>;
    if (!sub) return <div className="error-banner">Submission not found</div>;

    const p = sub.payload;
    const networkBlocked = preview?.network?.action === 'not_found';
    const filesDownloaded = sub.download_status === 'completed';
    // Duplicate status is final, so we only allow actions if pending or if it failed previous checks
    const canApprove = filesDownloaded && !networkBlocked && sub.status === 'pending';

    return (
        <div className="review-page">
            <button className="btn btn-back" onClick={() => navigate('/')}>← Back</button>

            <div className="review-header">
                <h2>Submission Review</h2>
                <div className="header-status">
                    <span className="status-badge" style={{ backgroundColor: STATUS_COLORS[sub.status] || '#6b7280' }}>
                        {sub.status}
                    </span>
                    {sub.status === 'duplicate' && <span className="duplicate-tag">AUTO-FLAGGED</span>}
                </div>
            </div>

            {error && <div className="error-banner">⚠️ {error}</div>}
            {sub.error_detail && <div className="error-banner">Pipeline Error: {sub.error_detail}</div>}

            {/* Form Fields */}
            <section className="section">
                <h3>Flight Details</h3>
                <div className="details-grid">
                    <Detail label="Network" value={p.network_name} />
                    <Detail label="Source Location" value={p.source_location_name} />
                    <Detail label="Source Takeoff Zone" value={p.source_takeoff_zone_name} />
                    <Detail label="Source Lat/Lng" value={`${p.source_latitude}, ${p.source_longitude}`} />
                    <Detail label="Destination Location" value={p.destination_location_name} />
                    <Detail label="Destination LZ" value={p.destination_landing_zone_name} />
                    <Detail label="Dest Lat/Lng" value={`${p.destination_latitude}, ${p.destination_longitude}`} />
                    <Detail label="Takeoff Direction" value={`${p.takeoff_direction}°`} />
                    <Detail label="Approach Direction" value={`${p.approach_direction}°`} />
                    <Detail label="Mission File" value={p.mission_filename} />
                </div>
            </section>

            {/* File Download */}
            <section className="section">
                <h3>File Download</h3>
                <div className="download-status">
                    <span className={`dl-badge dl-${sub.download_status}`}>
                        {sub.download_status.replace('_', ' ')}
                    </span>
                    {sub.status === 'pending' && (
                        <button className="btn btn-primary" onClick={handleDownload} disabled={downloading}>
                            {downloading ? 'Downloading...' : '📥 Download Files'}
                        </button>
                    )}
                </div>
                {sub.download_status === 'failed' && (
                    <p className="dl-error-hint">
                        <strong>Possible Fix:</strong> Ensure the Google Drive links are shared as
                        <em> "Anyone with the link"</em> and not restricted.
                    </p>
                )}
            </section>

            {/* Cesium Viewer */}
            {waypoints && (
                <section className="section">
                    <h3>3D Waypoint Viewer ({waypoints.total_waypoints} waypoints)</h3>
                    <CesiumViewer waypoints={waypoints.waypoints} />
                </section>
            )}

            {/* Resolve Preview */}
            {preview && (
                <section className="section">
                    <h3>ID Resolution Preview</h3>
                    {networkBlocked && (
                        <div className="error-banner">⚠️ Network does not exist. Contact supervisor.</div>
                    )}
                    <table className="preview-table">
                        <thead>
                            <tr><th>Entity</th><th>Name</th><th>ID</th><th>Action</th></tr>
                        </thead>
                        <tbody>
                            <PreviewRow label="Network" data={preview.network} />
                            <PreviewRow label="Source Location" data={preview.source_location} />
                            <PreviewRow label="Source LZ" data={preview.source_lz} />
                            <PreviewRow label="Dest Location" data={preview.destination_location} />
                            <PreviewRow label="Dest LZ" data={preview.destination_lz} />
                            <PreviewRow label="Waypoint File" data={preview.waypoint_file} />
                            <PreviewRow label="Flight Route" data={preview.flight_route} />
                        </tbody>
                    </table>
                    {preview.warnings.length > 0 && (
                        <div className="warnings">
                            {preview.warnings.map((w, i) => <div key={i} className="warning-item">⚠ {w}</div>)}
                        </div>
                    )}
                </section>
            )}

            {/* Action Buttons */}
            {sub.status === 'pending' && (
                <section className="section actions">
                    <button className="btn btn-success" onClick={handleApprove}
                        disabled={!canApprove || approving}>
                        {approving ? 'Approving...' : '✓ Approve'}
                    </button>
                    <button className="btn btn-secondary" onClick={handleMarkDuplicate}>
                        🛡️ Mark as Duplicate
                    </button>
                    <button className="btn btn-danger" onClick={() => setShowRejectModal(true)}>
                        ✗ Reject
                    </button>
                </section>
            )}

            {/* Confirmation Modal */}
            {showConfirmModal && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h3>Confirm New Entities</h3>
                        <p>The following new entries will be created:</p>
                        {['source_location', 'source_lz', 'destination_location', 'destination_lz'].map(key => {
                            if (preview[key]?.action !== 'new') return null;
                            const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                            return (
                                <label key={key} className="confirm-check">
                                    <input type="checkbox" checked={confirmations[key]}
                                        onChange={e => setConfirmations({ ...confirmations, [key]: e.target.checked })} />
                                    {label}: {preview[key].name} (ID: {preview[key].id})
                                </label>
                            );
                        })}
                        <div className="modal-actions">
                            <button className="btn btn-success" onClick={executeApproval}>Confirm & Approve</button>
                            <button className="btn btn-secondary" onClick={() => setShowConfirmModal(false)}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Reject Modal */}
            {showRejectModal && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h3>Reject Submission</h3>
                        <textarea placeholder="Reason (optional)" value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)} rows={3} />
                        <div className="modal-actions">
                            <button className="btn btn-danger" onClick={handleReject}>Reject</button>
                            <button className="btn btn-secondary" onClick={() => setShowRejectModal(false)}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function Detail({ label, value }) {
    return (
        <div className="detail-item">
            <span className="detail-label">{label}</span>
            <span className="detail-value">{value}</span>
        </div>
    );
}

function PreviewRow({ label, data }) {
    const actionClass = data.action === 'new' ? 'action-new' :
        data.action === 'not_found' ? 'action-error' : 'action-existing';
    return (
        <tr>
            <td>{label}</td>
            <td>{data.name || '—'}</td>
            <td>{data.id ?? '—'}</td>
            <td><span className={`action-badge ${actionClass}`}>{data.action}</span></td>
        </tr>
    );
}
