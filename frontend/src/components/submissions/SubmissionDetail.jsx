import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Lock, RefreshCw, X, Shield, History, Globe, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
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
    const colors = {
        'SUBMITTED': 'bg-blue-500/10 text-blue-500 border-blue-500/20',
        'WAYPOINT_VERIFIED': 'bg-amber-500/10 text-amber-500 border-amber-500/20',
        'ID_RESOLUTION_CONFIRMED': 'bg-purple-500/10 text-purple-500 border-purple-500/20',
        'PIPELINE_RUNNING': 'bg-primary/10 text-primary border-primary/20 animate-pulse',
        'PIPELINE_COMPLETE': 'bg-green-500/10 text-green-500 border-green-500/20',
        'PIPELINE_FAILED': 'bg-danger/10 text-danger border-danger/20',
        'REJECTED': 'bg-danger/10 text-danger border-danger/20'
    };
    const colorClass = colors[state] || 'bg-text-muted/10 text-text-muted border-text-muted/20';
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border ${colorClass}`}>{label}</span>;
}

export function SubmissionDetailContent({ submissionId, onBack }) {
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
    const [confirmations, setConfirmations] = useState({});

    const loadSubmission = async (silent = false) => {
        if (!silent) setLoading(true);
        setError(null);
        try {
            const data = await api.getSubmission(submissionId);
            setSub(data);
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
        <div className="p-12 flex flex-col items-center justify-center gap-4 animate-pulse">
            <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
            <span className="text-xs font-bold text-text-muted uppercase tracking-widest">Synchronizing Metadata...</span>
        </div>
    );
    
    if (!sub) return <div className="p-8 text-center text-danger font-bold uppercase tracking-widest">Submission Not Found</div>;

    const p = sub.payload;
    const waypointVerified = sub.waypoint_verified;
    const idResolutionReviewed = sub.id_resolution_reviewed;
    const isPipelineComplete = sub.workflow_state === 'PIPELINE_COMPLETE';
    const isRejected = sub.status === 'rejected';

    return (
        <div className="flex flex-col gap-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-border pb-8">
                <div className="flex items-center gap-4">
                    {onBack && (
                        <button onClick={onBack} className="p-2.5 hover:bg-surface border border-border rounded-2xl transition-all shadow-sm group">
                            <ArrowLeft size={20} className="text-text-muted group-hover:text-primary" />
                        </button>
                    )}
                    <div>
                        <div className="flex items-center gap-3 mb-1.5">
                            <h1 className="text-2xl font-bold tracking-tighter text-text">RW-{sub.serial_id || sub.id.substring(0, 8)}</h1>
                            <StatusBadge status={sub.status} />
                            <WorkflowBadge state={sub.workflow_state} />
                        </div>
                        <div className="flex items-center gap-3 text-xs font-medium text-text-muted">
                            <span className="flex items-center gap-1.5"><Globe size={14} /> {p.network_name}</span>
                            <span className="opacity-30">|</span>
                            <span>{p.source_location_name} → {p.destination_location_name}</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {sub.status === 'pending' && (
                        <RequiresRole role="reviewer">
                            <button 
                                onClick={() => setShowRejectModal(true)}
                                className="px-5 py-2.5 bg-danger/10 text-danger border border-danger/20 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-danger/20 transition-all"
                            >
                                Reject
                            </button>
                        </RequiresRole>
                    )}
                    <button onClick={() => loadSubmission()} className="p-2.5 bg-surface border border-border rounded-xl text-text-muted hover:text-primary transition-all shadow-sm">
                        <RefreshCw size={18} />
                    </button>
                </div>
            </div>

            {error && (
                <div className="p-4 bg-danger/5 border border-danger/20 rounded-2xl flex items-center gap-3 text-danger text-xs font-bold">
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Details Column */}
                <div className="lg:col-span-7 space-y-8">
                    {p.is_update && originalRoute && (
                        <div className="bg-surface border border-border rounded-3xl overflow-hidden shadow-sm">
                            <div className="px-8 py-4 bg-bg/50 border-b border-border flex items-center justify-between">
                                <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Proposed Changes</h3>
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-primary">
                                    <History size={12} /> Diff Engine
                                </div>
                            </div>
                            <div className="p-8">
                                <div className="space-y-4">
                                    {Object.keys(FIELD_LABELS).map(key => (
                                        <DiffDisplay
                                            key={key}
                                            label={FIELD_LABELS[key]}
                                            oldValue={originalRoute[key]}
                                            newValue={p[key]}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="bg-surface border border-border rounded-3xl overflow-hidden shadow-sm">
                        <div className="px-8 py-4 bg-bg/50 border-b border-border">
                            <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Submission Parameters</h3>
                        </div>
                        <div className="p-8 grid grid-cols-2 gap-x-12 gap-y-6">
                            {Object.entries(FIELD_LABELS).map(([key, label]) => (
                                <div key={key} className="flex flex-col gap-1">
                                    <span className="text-[9px] font-bold text-text-muted uppercase tracking-tight">{label}</span>
                                    <span className="text-sm font-semibold text-text truncate" title={p[key]}>
                                        {p[key] || '—'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Sidebar Column */}
                <div className="lg:col-span-5 space-y-8">
                    {/* Control Panel */}
                    {!isPipelineComplete && !isRejected && (
                        <div className="bg-surface border-2 border-primary/10 rounded-3xl p-8 shadow-xl shadow-primary/5">
                            <div className="flex items-center gap-3 mb-8">
                                <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                                    <Shield size={22} />
                                </div>
                                <h3 className="text-lg font-bold tracking-tight">Authorisation Panel</h3>
                            </div>

                            <div className="space-y-4 mb-8">
                                <div className={`p-4 rounded-2xl border transition-all ${waypointVerified ? 'bg-success/5 border-success/20' : 'bg-bg border-border'}`}>
                                    <div className="flex items-center justify-between">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-xs font-bold uppercase tracking-tight">1. Waypoint Verification</span>
                                            <span className="text-[10px] text-text-muted">Validate route & elevation accuracy.</span>
                                        </div>
                                        {waypointVerified ? (
                                            <CheckCircle2 className="text-success" size={20} />
                                        ) : (
                                            <button 
                                                onClick={handleVerifyRoute}
                                                className="px-3 py-1 bg-primary text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-opacity"
                                            >
                                                Verify
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className={`p-4 rounded-2xl border transition-all ${idResolutionReviewed ? 'bg-success/5 border-success/20' : 'bg-bg border-border'}`}>
                                    <div className="flex items-center justify-between">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-xs font-bold uppercase tracking-tight">2. ID Resolution</span>
                                            <span className="text-[10px] text-text-muted">Confirm entity mappings in flights.db.</span>
                                        </div>
                                        {idResolutionReviewed ? (
                                            <CheckCircle2 className="text-success" size={20} />
                                        ) : (
                                            <button 
                                                disabled={!waypointVerified}
                                                onClick={() => setActiveTab(2)}
                                                className="px-3 py-1 bg-primary text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-30"
                                            >
                                                Resolve
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <RequiresRole role="reviewer">
                                <button 
                                    onClick={handleApprove}
                                    disabled={!waypointVerified || !idResolutionReviewed || approving}
                                    className="w-full py-4 bg-primary text-white rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 hover:opacity-95 disabled:opacity-30 disabled:shadow-none transition-all flex items-center justify-center gap-3"
                                >
                                    {approving ? <RefreshCw className="animate-spin" size={18} /> : <CheckCircle size={18} />}
                                    {approving ? 'EXECUTING PIPELINE...' : 'EXECUTE DB UPDATE'}
                                </button>
                            </RequiresRole>
                        </div>
                    )}

                    {/* Content Tabs */}
                    <div className="bg-surface border border-border rounded-3xl overflow-hidden shadow-sm flex flex-col h-[500px]">
                        <div className="flex border-b border-border bg-bg/30">
                            {TABS.map((tab, i) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(i)}
                                    className={`flex-1 px-4 py-4 text-[9px] font-bold uppercase tracking-widest transition-all ${activeTab === i ? 'text-primary bg-surface border-b-2 border-primary' : 'text-text-muted hover:text-text'}`}
                                >
                                    {tab.name}
                                </button>
                            ))}
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                            {activeTab === 0 && <WaypointViewerTab submission={sub} waypointData={waypoints} />}
                            {activeTab === 1 && <FilesTab submission={sub} />}
                            {activeTab === 2 && (
                                <IDResolutionTab 
                                    submission={sub} 
                                    preview={preview} 
                                    onConfirm={loadSubmission} 
                                    confirmations={confirmations}
                                    setConfirmations={setConfirmations}
                                />
                            )}
                            {activeTab === 3 && <ActivityLogTab submissionId={submissionId} />}
                        </div>
                    </div>
                </div>
            </div>

            {/* Rejection Modal */}
            {showRejectModal && (
                <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-surface border border-border rounded-3xl w-full max-w-lg shadow-2xl p-8 animate-in zoom-in-95">
                        <h3 className="text-xl font-bold text-text mb-2">Reject Submission</h3>
                        <p className="text-sm text-text-muted mb-6">Explain why this submission is being rejected. This will be visible to the operator.</p>
                        
                        <textarea 
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            className="w-full h-32 bg-bg border border-border rounded-2xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-danger/20 focus:border-danger text-text mb-6 resize-none"
                            placeholder="e.g. Mission file has incorrect waypoints, please re-upload."
                        />

                        <div className="flex gap-4">
                            <button 
                                onClick={() => setShowRejectModal(false)}
                                className="flex-1 py-3 bg-bg border border-border rounded-xl text-xs font-bold uppercase tracking-widest"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={handleReject}
                                disabled={rejectReason.length < 10}
                                className="flex-1 py-3 bg-danger text-white rounded-xl text-xs font-bold uppercase tracking-widest shadow-lg shadow-danger/20 disabled:opacity-30"
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
            <SubmissionDetailContent submissionId={submissionId} onBack={null} />
        );
    }

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <SubmissionDetailContent submissionId={submissionId} onBack={() => navigate(-1)} />
        </div>
    );
}
