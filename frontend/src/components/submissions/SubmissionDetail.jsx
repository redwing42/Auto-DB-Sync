import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Lock } from 'lucide-react';
import { api } from '../../api/api';
import StatusBadge from '../shared/StatusBadge';
import WaypointViewerTab from '../tabs/WaypointViewerTab';
import FilesTab from '../tabs/FilesTab';
import IDResolutionTab from '../tabs/IDResolutionTab';
import ActivityLogTab from '../tabs/ActivityLogTab';
import RequiresRole from '../shared/RequiresRole';
import DiffDisplay from '../submit/DiffDisplay';

const TABS = [
    { name: 'Waypoint Viewer', id: 'waypoints' },
    { name: 'Files', id: 'files' },
    { name: 'ID Resolution', id: 'resolution', locked: true },
    { name: 'Activity Log', id: 'activity' },
];

const FIELD_LABELS = {
    network_name: 'Network', source_location_name: 'Source Location',
    source_takeoff_zone_name: 'Takeoff Zone', source_latitude: 'Source Lat',
    source_longitude: 'Source Lng', destination_location_name: 'Dest Location',
    destination_landing_zone_name: 'Landing Zone', destination_latitude: 'Dest Lat',
    destination_longitude: 'Dest Lng', takeoff_direction: 'Takeoff Dir',
    approach_direction: 'Approach Dir', mission_filename: 'Mission File',
    mission_drive_link: 'Mission Link', elevation_image_drive_link: 'Elevation Link',
    route_image_drive_link: 'Route Image Link',
};

const WORKFLOW_LABELS = {
    'SUBMITTED': 'Submitted',
    'WAYPOINT_VERIFIED': 'Validated',
    'ID_RESOLUTION_CONFIRMED': 'IDs Confirmed',
    'PIPELINE_RUNNING': 'Pipeline Running',
    'PIPELINE_COMPLETE': 'DB Updated',
    'PIPELINE_FAILED': 'Failed',
    'REJECTED': 'Rejected'
};

function WorkflowBadge({ state }) {
    const label = WORKFLOW_LABELS[state] || state;
    const className = `workflow-badge state-${state?.toLowerCase()}`;
    return <span className={className}>{label}</span>;
}

export default function SubmissionDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [sub, setSub] = useState(null);
    const [preview, setPreview] = useState(null);
    const [waypoints, setWaypoints] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState(0);
    const [originalRoute, setOriginalRoute] = useState(null);
    const [approving, setApproving] = useState(false);
    const [rejectReason, setRejectReason] = useState('');
    const [showRejectModal, setShowRejectModal] = useState(false);

    // Confirmation storage for the approve call
    const [confirmations, setConfirmations] = useState({});

    // Gate 1 Checkboxes (Local State)
    const [check1, setCheck1] = useState(false);
    const [check2, setCheck2] = useState(false);
    const [check3, setCheck3] = useState(false);
    const [verifying, setVerifying] = useState(false);

    const loadSubmission = async (silent = false) => {
        if (!silent) setLoading(true);
        setError(null);
        try {
            const data = await api.getSubmission(id);
            setSub(data);
            try {
                const previewData = await api.getResolvePreview(id);
                setPreview(previewData);
            } catch (err) {
                console.error("Failed to load resolve preview:", err);
            }
            if (data.download_status === 'completed') {
                try {
                    const wpData = await api.getWaypointData(id);
                    setWaypoints(wpData);
                } catch (err) {
                    console.error("Failed to load waypoint data:", err);
                }
            }
            if (data.payload.is_update && data.payload.update_for_route_id) {
                try {
                    const od = await api.getRoute(data.payload.update_for_route_id);
                    setOriginalRoute({
                        network_name: data.payload.network_name,
                        source_location_name: od.start_location_name,
                        source_takeoff_zone_name: od.start_lz_name,
                        source_latitude: od.start_latitude,
                        source_longitude: od.start_longitude,
                        destination_location_name: od.end_location_name,
                        destination_landing_zone_name: od.end_lz_name,
                        destination_latitude: od.end_latitude,
                        destination_longitude: od.end_longitude,
                        takeoff_direction: od.takeoff_direction,
                        approach_direction: od.approach_direction,
                        mission_filename: od.mission_filename || '',
                        mission_drive_link: '',
                        elevation_image_drive_link: '',
                        route_image_drive_link: '',
                    });
                } catch (err) {
                    console.error("Failed to load original route for diff:", err);
                }
            }
        } catch (err) {
            setError(err.message);
        } finally {
            if (!silent) setLoading(false);
        }
    };

    useEffect(() => { loadSubmission(); }, [id]);

    // Respond to ?tab= query param from nav buttons
    useEffect(() => {
        const tab = searchParams.get('tab');
        if (tab === 'files') setActiveTab(1);
        else if (tab === 'resolution') setActiveTab(2);
    }, [searchParams]);

    useEffect(() => {
        if (sub && sub.payload.is_update && activeTab === 0 && !searchParams.get('tab')) {
            setActiveTab(-1);
        }
    }, [sub, searchParams]);

    if (loading) return <div className="loading-state">Loading submission...</div>;
    if (!sub) return <div className="banner banner-error">Submission not found.</div>;

    const p = sub.payload;
    const waypointVerified = sub.waypoint_verified;
    const idResolutionReviewed = sub.id_resolution_reviewed;

    // Approve enabled ONLY when BOTH gates pass
    const canApprove = waypointVerified && idResolutionReviewed && sub.status === 'pending';

    const approveTooltip = !waypointVerified
        ? "Complete waypoint verification first"
        : !idResolutionReviewed
            ? "Review ID Resolution tab first"
            : "";

    const handleApprove = async () => {
        setApproving(true);
        setError(null);
        try {
            // BULLETPROOF CONFIRMATIONS: 
            // If the user already passed the ID Resolution gate in the DB, 
            // we auto-confirm all "new" entities to prevent 403 errors if local state was lost on reload.
            const confirmed_new_entities = {
                source_location: confirmations.source_location || false,
                source_lz: confirmations.source_lz || false,
                destination_location: confirmations.destination_location || false,
                destination_lz: confirmations.destination_lz || false,
            };

            if (idResolutionReviewed && preview) {
                ['source_location', 'source_lz', 'destination_location', 'destination_lz'].forEach(key => {
                    if (preview[key]?.action === 'new') {
                        confirmed_new_entities[key] = true;
                    }
                });
            }

            await api.approveSubmission(id, confirmed_new_entities);
            await loadSubmission(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setApproving(false);
        }
    };

    const handleReject = async () => {
        if (rejectReason.length < 10) return;
        try {
            await api.rejectSubmission(id, rejectReason);
            setShowRejectModal(false);
            await loadSubmission(true);
        } catch (err) {
            setError(err.message);
        }
    };

    const handleMarkDuplicate = async () => {
        if (!window.confirm('Are you sure you want to mark this as a duplicate?')) return;
        try {
            await api.markAsDuplicate(id);
            await loadSubmission(true);
        } catch (err) {
            setError(err.message);
        }
    };

    const handleVerifyRoute = async () => {
        setVerifying(true);
        try {
            await api.updateReviewState(id, { waypoint_verified: true });
            await loadSubmission(true);
        } catch (err) {
            alert(err.message);
        } finally {
            setVerifying(false);
        }
    };

    // ID Resolution tab clickable ONLY when gate 1 passes
    const idResolutionUnlocked = waypointVerified;

    return (
        <div style={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, paddingBottom: (activeTab === 0 && sub.status === 'pending') ? '80px' : '0' }}>
                {/* Header */}
                <div className="detail-header">
                    <button className="btn btn-ghost" onClick={() => navigate('/')}>
                        <ArrowLeft size={18} />
                    </button>
                    <h1>{sub.human_id || `Submission #${id.slice(0, 6)}`}</h1>
                    <span style={{ margin: '0 8px' }}>—</span>
                    <span style={{ fontWeight: 500 }}>{p.source_location_name} → {p.destination_location_name}</span>
                    {p.is_update && (
                        <span className="submission-type-badge update" style={{ marginLeft: '12px' }}>
                            UPDATE
                        </span>
                    )}
                    <div style={{ marginLeft: '12px', display: 'flex', gap: '16px', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <StatusBadge status={sub.status} />
                            {sub.status === 'approved' && sub.approved_by_name && (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>by {sub.approved_by_name}</span>
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {sub.workflow_state && <WorkflowBadge state={sub.workflow_state} />}
                        </div>
                    </div>
                </div>
                <div className="detail-subtitle" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    <span>{p.mission_filename}</span>
                    <span style={{ opacity: 0.5 }}>•</span>
                    <span>Received {new Date(sub.created_at).toLocaleString()}</span>
                </div>
                
                {/* Participant Ribbon */}
                <div className="participant-ribbon">
                    {sub.submitted_by_name && (
                        <div>
                            <div className="ribbon-label">Submitted by</div>
                            <div className="ribbon-value">{sub.submitted_by_name}</div>
                        </div>
                    )}
                    {sub.viewed_by_name && (
                        <div>
                            <div className="ribbon-label">Viewed by</div>
                            <div className="ribbon-value">{sub.viewed_by_name}</div>
                        </div>
                    )}
                    {sub.reviewed_by_name && (
                        <div>
                            <div className="ribbon-label">Reviewed by</div>
                            <div className="ribbon-value">{sub.reviewed_by_name}</div>
                        </div>
                    )}
                    {sub.verified_by_name && (
                        <div>
                            <div className="ribbon-label">Verified by</div>
                            <div className="ribbon-value">{sub.verified_by_name}</div>
                        </div>
                    )}
                    {sub.validated_by_name && (
                        <div>
                            <div className="ribbon-label">Validated by</div>
                            <div className="ribbon-value">{sub.validated_by_name}</div>
                        </div>
                    )}
                    {sub.approved_by_name && (
                        <div>
                            <div className="ribbon-label">Approved by</div>
                            <div className="ribbon-value">{sub.approved_by_name}</div>
                        </div>
                    )}
                    {sub.db_updated_by_name && (
                        <div>
                            <div className="ribbon-label">DB Updated by</div>
                            <div className="ribbon-value">{sub.db_updated_by_name}</div>
                        </div>
                    )}
                </div>

                {error && <div className="banner banner-error mb-16">⚠ {error}</div>}
                {sub.error_detail && <div className="banner banner-error mb-16">Pipeline Error: {sub.error_detail}</div>}
                {sub.status === 'failed' && <div className="banner banner-error mb-16">⚠ Mission execution failed. Check logs for details.</div>}
                {sub.status === 'rejected' && (
                    <div className="banner banner-caution mb-16 flex items-center justify-between">
                        <div>
                            <div className="font-bold flex items-center gap-2 mb-1">
                                <span className="text-lg">⚠</span> Mission Rejected
                            </div>
                            <div className="text-sm opacity-90">
                                <strong>Reason:</strong> {sub.status_metadata?.rejection_reason || 'No reason provided.'}
                            </div>
                        </div>
                        <RequiresRole role="operator">
                            <button
                                className="btn btn-sm btn-caution"
                                onClick={() => {
                                    const path = sub.payload?.is_update ? '/submit/update' : '/submit/new';
                                    navigate(`${path}?resubmit=${sub.id}`);
                                }}
                            >
                                Resubmit with Changes
                            </button>
                        </RequiresRole>
                    </div>
                )}

                {/* Tab and Action Row */}
                <div className="flex items-center justify-between border-bottom mb-24" style={{ borderBottom: '1px solid var(--border)' }}>
                    <div className="tabs" style={{ borderBottom: 'none', marginBottom: 0 }}>
                        {sub.payload.is_update && (
                            <button
                                className={`tab ${activeTab === -1 ? 'active' : ''}`}
                                onClick={() => setActiveTab(-1)}
                            >
                                Changes
                            </button>
                        )}
                        {TABS.map((tab, i) => {
                            const isLocked = tab.locked && !idResolutionUnlocked;
                            return (
                                <button
                                    key={tab.id}
                                    className={`tab ${activeTab === i ? 'active' : ''}`}
                                    onClick={() => !isLocked && setActiveTab(i)}
                                    disabled={isLocked}
                                    style={{
                                        cursor: isLocked ? 'not-allowed' : 'pointer',
                                        opacity: isLocked ? 0.5 : 1
                                    }}
                                >
                                    {tab.name} {isLocked && <Lock size={12} style={{ marginLeft: 4 }} />}
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex gap-8 items-center" style={{ paddingBottom: '8px' }}>
                        {sub.status === 'pending' && (
                            <>
                                <button className="btn btn-sm btn-ghost" onClick={handleMarkDuplicate}>
                                    Duplicate
                                </button>
                                <button className="btn btn-sm btn-ghost" onClick={() => setShowRejectModal(true)} style={{ color: 'var(--danger)' }}>
                                    Reject
                                </button>
                                <RequiresRole role="operator">
                                    <button
                                        className={`btn btn-sm ${canApprove ? 'btn-primary' : 'btn-secondary'}`}
                                        disabled={!canApprove || approving}
                                        onClick={handleApprove}
                                        title={approveTooltip}
                                    >
                                        {approving ? 'Approving...' : 'Approve ↑'}
                                    </button>
                                </RequiresRole>
                            </>
                        )}
                    </div>
                </div>

                {/* Tab Content */}
                <div className="tab-content" style={{ padding: '0 24px' }}>
                    {activeTab === -1 && sub.payload.is_update && (
                        <div style={{ paddingTop: '24px' }} className="diff-summary">
                            {originalRoute ? (
                                Object.keys(FIELD_LABELS).map(key => (
                                    <DiffDisplay
                                        key={key}
                                        label={FIELD_LABELS[key]}
                                        oldValue={originalRoute[key]}
                                        newValue={sub.payload[key]}
                                    />
                                ))
                            ) : (
                                <div className="banner banner-error">Loading original route data or none provided...</div>
                            )}
                        </div>
                    )}
                    {activeTab === 0 && (
                        <WaypointViewerTab waypoints={waypoints} sub={sub} />
                    )}
                    {activeTab === 1 && (
                        <FilesTab sub={sub} onReload={loadSubmission} />
                    )}
                    {activeTab === 2 && (
                        <IDResolutionTab
                            preview={preview}
                            sub={sub}
                            onReviewed={(collectedConfirmations) => {
                                if (collectedConfirmations) {
                                    setConfirmations(collectedConfirmations);
                                }
                                loadSubmission(true); // Silent reload to preserve state
                            }}
                        />
                    )}
                    {activeTab === 3 && (
                        <ActivityLogTab submissionId={id} />
                    )}
                </div>
            </div>

            {/* STICKY FOOTER */}
            {activeTab === 0 && sub.status === 'pending' && (
                <div className="verification-footer">
                    {!waypointVerified ? (
                        <div className="gate-bar">
                            <div className="gate-checks">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={check1}
                                        onChange={e => setCheck1(e.target.checked)}
                                    />
                                    Reviewed route on map
                                </label>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={check2}
                                        onChange={e => setCheck2(e.target.checked)}
                                    />
                                    Reviewed elevation profile
                                </label>
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={check3}
                                        onChange={e => setCheck3(e.target.checked)}
                                    />
                                    Route matches source → destination
                                </label>
                            </div>
                            <button
                                className={`btn ${(check1 && check2 && check3) ? 'btn-primary' : 'btn-secondary'}`}
                                disabled={!check1 || !check2 || !check3 || verifying}
                                onClick={handleVerifyRoute}
                            >
                                {verifying ? 'Saving...' : 'Mark Route as Verified'}
                            </button>
                        </div>
                    ) : (
                        <div className="gate-bar gate-passed">
                            <span className="gate-passed-text">✓ Route verified — open ID Resolution tab to continue</span>
                        </div>
                    )}
                </div>
            )}

            {/* Reject Modal */}
            {showRejectModal && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h3>Reject Submission</h3>
                        <p>Provide a reason for rejection (minimum 10 characters).</p>
                        <textarea
                            placeholder="Reason for rejection (required)"
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            rows={3}
                        />
                        <div className="modal-actions">
                            <button className="btn" onClick={() => setShowRejectModal(false)}>Cancel</button>
                            <button
                                className="btn btn-danger"
                                onClick={handleReject}
                                disabled={rejectReason.length < 10}
                            >
                                Reject
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
