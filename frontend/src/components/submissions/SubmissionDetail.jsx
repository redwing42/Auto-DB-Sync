import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, RefreshCw, History, Globe, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../../api/api';
import StatusBadge from '../shared/StatusBadge';
import WaypointViewerTab from '../tabs/WaypointViewerTab';
import FilesTab from '../tabs/FilesTab';
import IDResolutionTab from '../tabs/IDResolutionTab';
import ActivityLogTab from '../tabs/ActivityLogTab';
import RequiresRole from '../shared/RequiresRole';
import DiffDisplay from '../submit/DiffDisplay';
import { HoveredWaypointProvider } from '../../context/HoveredWaypointContext';

const TABS = [
    { name: 'Details', id: 'details' },
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
    if (!state) return null;
    const label = WORKFLOW_LABELS[state] || state;
    const className = `workflow-badge state-${state.toLowerCase()}`;
    return <span className={className} style={{ fontSize: '10px' }}>{label}</span>;
}

export function SubmissionDetailContent({ submissionId, onBack, embedded = false }) {
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
    const [searchParams, setSearchParams] = useSearchParams();
    const [waypointVerification, setWaypointVerification] = useState({
        mapReviewed: false,
        elevationReviewed: false,
        tableReviewed: false,
        filesReviewed: false,
    });

    const loadSubmission = async (silent = false) => {
        if (!silent) setLoading(true);
        setError(null);
        try {
            const data = await api.getSubmission(submissionId);
            setSub(data);
            setWaypointVerification({
                mapReviewed: false,
                elevationReviewed: false,
                tableReviewed: false,
                filesReviewed: false,
            });
            try {
                const previewData = await api.getResolvePreview(submissionId);
                setPreview(previewData);
            } catch (err) {
                console.error("Failed to load resolve preview:", err);
            }
            if (data.download_status === 'completed') {
                try {
                    const wpData = await api.getWaypointData(submissionId);
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

    useEffect(() => { loadSubmission(); }, [submissionId]);

    const selectTab = useCallback((i) => {
        setActiveTab(i);
        if (embedded) return;
        setSearchParams((prev) => {
            const n = new URLSearchParams(prev);
            n.set('tab', TABS[i].id);
            return n;
        }, { replace: true });
    }, [embedded, setSearchParams]);

    useEffect(() => {
        if (embedded) return;
        const t = searchParams.get('tab');
        if (!t) {
            setActiveTab(0);
            setSearchParams((prev) => {
                const n = new URLSearchParams(prev);
                n.set('tab', 'details');
                return n;
            }, { replace: true });
            return;
        }
        const idx = TABS.findIndex((tab) => tab.id === t);
        if (idx >= 0) setActiveTab(idx);
    }, [embedded, searchParams, submissionId]);

    const handleApprove = async () => {
        setApproving(true);
        setError(null);
        try {
            const confirmed_new_entities = {};
            if (preview) {
                ['source_location', 'source_lz', 'destination_location', 'destination_lz'].forEach(key => {
                    if (preview[key]?.action === 'new') {
                        confirmed_new_entities[key] = true;
                    }
                });
            }
            await api.approveSubmission(submissionId, confirmed_new_entities);
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
            await api.rejectSubmission(submissionId, rejectReason);
            setShowRejectModal(false);
            await loadSubmission(true);
        } catch (err) {
            setError(err.message);
        }
    };

    const handleVerifyRoute = async () => {
        try {
            await api.updateReviewState(submissionId, { waypoint_verified: true });
            await loadSubmission(true);
        } catch (err) {
            setError(err.message);
        }
    };

    if (loading) return (
        <div className="submission-detail__loading">
            <div className="submission-detail__spinner" />
            <span className="submission-detail__loading-label">Synchronizing Metadata...</span>
        </div>
    );

    if (!sub) return <div className="submission-detail__not-found">Submission Not Found</div>;

    const p = sub.payload;
    const waypointVerified = sub.waypoint_verified;
    const allWaypointChecksDone = Object.values(waypointVerification).every(Boolean);
    const idResolutionReviewed = sub.id_resolution_reviewed;
    const isPipelineComplete = sub.workflow_state === 'PIPELINE_COMPLETE';
    const isRejected = sub.status === 'rejected';

    return (
        <div className="submission-detail">
            <div className="submission-detail__header">
                <div className="submission-detail__title-block">
                    {onBack && (
                        <button type="button" onClick={onBack} className="submission-detail__back-btn" aria-label="Back">
                            <ArrowLeft size={20} />
                        </button>
                    )}
                    <div>
                        <div className="submission-detail__title-row">
                            <h1 className="submission-detail__title">RW-{sub.serial_id || sub.id.substring(0, 8)}</h1>
                            <StatusBadge status={sub.status} />
                            <WorkflowBadge state={sub.workflow_state} />
                        </div>
                        <div className="submission-detail__meta">
                            <span className="flex items-center gap-8"><Globe size={14} /> {p.network_name}</span>
                            <span className="submission-detail__muted-pipe">|</span>
                            <span>{p.source_location_name} → {p.destination_location_name}</span>
                        </div>
                    </div>
                </div>

                <div className="submission-detail__header-actions">
                    {sub.status === 'pending' && (
                        <RequiresRole role="reviewer">
                            <button
                                type="button"
                                onClick={() => setShowRejectModal(true)}
                                className="submission-detail__reject"
                            >
                                Reject
                            </button>
                        </RequiresRole>
                    )}
                    <button type="button" onClick={() => loadSubmission()} className="submission-detail__icon-btn" aria-label="Refresh">
                        <RefreshCw size={18} />
                    </button>
                </div>
            </div>

            {error && (
                <div className="submission-detail__alert">
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            {!isPipelineComplete && !isRejected && (
                <div className="submission-detail__auth-bar">
                    <span className="submission-detail__auth-bar-label">Review</span>
                    <div className="submission-detail__auth-bar-steps">
                        <div className="submission-detail__auth-bar-step">
                            <span style={{ fontWeight: 700, color: 'var(--text)' }}>1. Waypoints</span>
                            {waypointVerified ? (
                                <CheckCircle2 style={{ color: 'var(--success)' }} size={18} />
                            ) : (
                                <button
                                    type="button"
                                    onClick={handleVerifyRoute}
                                    className="submission-detail__btn-sm"
                                    disabled={!allWaypointChecksDone}
                                    title={!allWaypointChecksDone ? 'Complete waypoint verification checklist first' : undefined}
                                >
                                    Verify
                                </button>
                            )}
                        </div>
                        <div className="submission-detail__auth-bar-step">
                            <span style={{ fontWeight: 700, color: 'var(--text)' }}>2. IDs</span>
                            {idResolutionReviewed ? (
                                <CheckCircle2 style={{ color: 'var(--success)' }} size={18} />
                            ) : (
                                <button
                                    type="button"
                                    disabled={!waypointVerified}
                                    onClick={() => selectTab(3)}
                                    className="submission-detail__btn-sm"
                                >
                                    Resolve
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="submission-detail__auth-bar-actions">
                        <RequiresRole role="reviewer">
                            <button
                                type="button"
                                onClick={handleApprove}
                                disabled={!waypointVerified || !idResolutionReviewed || approving}
                                className="submission-detail__approve submission-detail__approve--compact"
                            >
                                {approving ? <RefreshCw className="spin" size={18} /> : <CheckCircle size={18} />}
                                {approving ? 'EXECUTING…' : 'EXECUTE DB UPDATE'}
                            </button>
                        </RequiresRole>
                    </div>
                </div>
            )}

            <div className="submission-detail__tabs submission-detail__tabs--primary">
                <div className="submission-detail__tab-bar">
                    {TABS.map((tab, i) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => selectTab(i)}
                            className={`submission-detail__tab ${activeTab === i ? 'submission-detail__tab--active' : ''}`}
                        >
                            {tab.name}
                        </button>
                    ))}
                </div>
                <div className="submission-detail__tab-panel submission-detail__tab-panel--main custom-scrollbar">
                    {activeTab === 0 && (
                        <div className="submission-detail__col">
                            {p.is_update && originalRoute && (
                                <div className="submission-detail__card">
                                    <div className="submission-detail__card-head">
                                        <h3 className="submission-detail__card-title">Proposed Changes</h3>
                                        <div className="flex items-center gap-8" style={{ fontSize: '10px', fontWeight: 700, color: 'var(--primary)' }}>
                                            <History size={12} /> Diff Engine
                                        </div>
                                    </div>
                                    <div className="submission-detail__card-body">
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                            {Object.keys(FIELD_LABELS).map(key => (
                                                <DiffDisplay
                                                    key={key}
                                                    field={key}
                                                    label={FIELD_LABELS[key]}
                                                    oldValue={originalRoute[key]}
                                                    newValue={p[key]}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="submission-detail__card">
                                <div className="submission-detail__card-head submission-detail__card-head--simple">
                                    <h3 className="submission-detail__card-title">Submission Parameters</h3>
                                </div>
                                <div className="submission-detail__card-body submission-detail__params">
                                    {Object.entries(FIELD_LABELS).map(([key, label]) => (
                                        <div key={key} className="submission-detail__field">
                                            <span className="submission-detail__field-label">{label}</span>
                                            <span className="submission-detail__field-value" title={p[key]}>
                                                {p[key] || '—'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                    {activeTab === 1 && (
                        <HoveredWaypointProvider>
                            <WaypointViewerTab
                                sub={sub}
                                waypoints={waypoints}
                                verification={waypointVerification}
                                setVerification={setWaypointVerification}
                            />
                        </HoveredWaypointProvider>
                    )}
                    {activeTab === 2 && (
                        <FilesTab sub={sub} onReload={() => loadSubmission(true)} />
                    )}
                    {activeTab === 3 && (
                        <IDResolutionTab
                            sub={sub}
                            preview={preview}
                            onReviewed={() => loadSubmission(true)}
                        />
                    )}
                    {activeTab === 4 && <ActivityLogTab submissionId={submissionId} />}
                </div>
            </div>

            {showRejectModal && (
                <div className="submission-detail__modal-overlay">
                    <div className="submission-detail__modal">
                        <h3 className="submission-detail__modal-title">Reject Submission</h3>
                        <p className="submission-detail__modal-text">Explain why this submission is being rejected. This will be visible to the operator.</p>

                        <textarea
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            className="submission-detail__textarea"
                            placeholder="e.g. Mission file has incorrect waypoints, please re-upload."
                        />

                        <div className="submission-detail__modal-actions">
                            <button
                                type="button"
                                onClick={() => setShowRejectModal(false)}
                                className="btn"
                                style={{ flex: 1 }}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleReject}
                                disabled={rejectReason.length < 10}
                                className="btn btn-danger"
                                style={{ flex: 1 }}
                            >
                                Confirm Rejection
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function SubmissionDetail({ id: propId, embedded = false }) {
    const routeParams = useParams();
    const navigate = useNavigate();
    const submissionId = propId || routeParams.id;

    if (!submissionId) {
        return null;
    }

    if (embedded) {
        return (
            <SubmissionDetailContent submissionId={submissionId} onBack={null} embedded />
        );
    }

    return (
        <div className="submission-detail-page-wrap">
            <SubmissionDetailContent submissionId={submissionId} onBack={() => navigate(-1)} embedded={false} />
        </div>
    );
}
