import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/api';
import { useToast } from '../components/shared/Toast';
import StatusBadge from '../components/shared/StatusBadge';

function timeAgo(dateStr) {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = Math.max(0, now - then);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

const OWNER_MAPPING = {
    'SUBMITTED': 'Reviewer',
    'WAYPOINT_VERIFIED': 'SDE',
    'ID_RESOLUTION_CONFIRMED': 'SDE',
    'PIPELINE_RUNNING': 'System',
    'PIPELINE_COMPLETE': '—',
    'PIPELINE_FAILED': 'SDE',
    'REJECTED': 'Operator'
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

function RoutePopover({ sub }) {
    const steps = [
        { label: 'Submitted', key: 'SUB', actor: sub.submitted_by_name, complete: true },
        { label: 'Files Downloaded', key: 'DL', actor: 'System', complete: sub.files_downloaded },
        { label: 'Waypoint Verified', key: 'VER', actor: sub.verified_by_name || sub.reviewed_by_name, complete: sub.waypoint_verified },
        { label: 'ID Resolution Validated', key: 'VAL', actor: sub.validated_by_name, complete: sub.id_resolution_reviewed },
        { label: 'SDE Approved', key: 'APP', actor: sub.approved_by_name, complete: sub.status === 'approved' },
        { label: 'Database Updated', key: 'DB', actor: sub.db_updated_by_name, complete: sub.workflow_state === 'PIPELINE_COMPLETE' },
    ];

    return (
        <div className="route-popover">
            <div className="popover-title">
                <span>Workflow Status</span>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '10px', opacity: 0.6 }}>{sub.human_id}</span>
                </div>
            </div>
            <div className="popover-grid">
                {steps.map((step, i) => (
                    <div key={step.key} className={`popover-step ${step.complete ? 'complete' : ''}`}>
                        <div className="step-circle">{step.complete ? '✓' : i + 1}</div>
                        <div className="step-content">
                            <span className="step-label">{step.label}</span>
                            {step.complete && step.actor && (
                                <span className="step-actor">by {step.actor}</span>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ActorBubble({ label, name, role, complete }) {
    const initials = name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : label;
    return (
        <div className={`actor-bubble ${complete ? 'complete' : ''}`}>
            {initials}
            <div className="actor-bubble-tooltip">
                <strong>{label}</strong>: {name || 'Pending'}
            </div>
        </div>
    );
}

function ActivityCell({ sub }) {
    const actors = [
        { label: 'SUB', name: sub.submitted_by_name, complete: true },
        { label: 'VIEW', name: sub.viewed_by_name, complete: !!sub.viewed_by_name },
        { label: 'VER', name: sub.verified_by_name || sub.reviewed_by_name, complete: sub.waypoint_verified },
        { label: 'VAL', name: sub.validated_by_name, complete: sub.id_resolution_reviewed },
        { label: 'APP', name: sub.approved_by_name, complete: sub.status === 'approved' },
        { label: 'DB', name: sub.db_updated_by_name, complete: sub.workflow_state === 'PIPELINE_COMPLETE' },
    ];

    return (
        <div className="activity-cell">
            {actors.map(actor => (
                <ActorBubble
                    key={actor.label}
                    label={actor.label}
                    name={actor.name}
                    complete={actor.complete}
                />
            ))}
        </div>
    );
}

export default function InboxPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const statusFilter = searchParams.get('status');
    const addToast = useToast();

    const [submissions, setSubmissions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const prevIdsRef = useRef(new Set());

    const fetchSubmissions = async (isPolling = false) => {
        if (!isPolling) setLoading(true);
        setError(null);
        try {
            const data = await api.listSubmissions();
            // Detect new submissions for toast
            if (isPolling && prevIdsRef.current.size > 0) {
                for (const sub of data) {
                    if (!prevIdsRef.current.has(sub.id)) {
                        addToast(`New submission: ${sub.payload.source_location_name} → ${sub.payload.destination_location_name}`);
                    }
                }
            }
            prevIdsRef.current = new Set(data.map(s => s.id));
            setSubmissions(data);
        } catch (err) {
            if (!isPolling) setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchSubmissions(); }, []);

    // Poll every 10s
    useEffect(() => {
        const interval = setInterval(() => fetchSubmissions(true), 10000);
        return () => clearInterval(interval);
    }, []);

    const filtered = statusFilter
        ? submissions.filter(s => s.status === statusFilter)
        : submissions;

    if (loading) return <div className="loading-state">Loading submissions...</div>;

    return (
        <div>
            <div className="page-header">
                <h1>Submissions {statusFilter && `— ${statusFilter}`}</h1>
                <button className="btn" onClick={() => fetchSubmissions()}>↻ Refresh</button>
            </div>

            <div className="tabs">
                <button
                    className={`tab ${!statusFilter ? 'active' : ''}`}
                    onClick={() => navigate('/submissions')}
                >
                    All
                </button>
                <button
                    className={`tab ${statusFilter === 'pending' ? 'active' : ''}`}
                    onClick={() => navigate('/submissions?status=pending')}
                >
                    Pending
                </button>
                <button
                    className={`tab ${statusFilter === 'approved' ? 'active' : ''}`}
                    onClick={() => navigate('/submissions?status=approved')}
                >
                    Approved
                </button>
                <button
                    className={`tab ${statusFilter === 'rejected' ? 'active' : ''}`}
                    onClick={() => navigate('/submissions?status=rejected')}
                >
                    Rejected
                </button>
                <button
                    className={`tab ${statusFilter === 'failed' ? 'active' : ''}`}
                    onClick={() => navigate('/submissions?status=failed')}
                >
                    Failed
                </button>
            </div>

            {error && <div className="banner banner-error">⚠ {error}</div>}

            {filtered.length === 0 ? (
                <div className="empty-state">
                    <p>No submissions{statusFilter ? ` with status "${statusFilter}"` : ' yet'}.</p>
                </div>
            ) : (
                <table className="data-table">
                    <thead>
                        <tr>
                            <th style={{ width: 30 }}></th>
                            <th>ID</th>
                            <th>Route</th>
                            <th>Mission File</th>
                            <th>Network</th>
                            <th>Activity</th>
                            <th>Status</th>
                            <th>Current Owner</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((sub) => (
                            <tr
                                key={sub.id}
                                onClick={() => navigate(`/submissions/${sub.id}`)}
                                className={!prevIdsRef.current.has(sub.id) ? 'row-new' : ''}
                            >
                                <td>
                                    {sub.status === 'pending' && <span className="unread-dot" />}
                                </td>
                                <td className="table-id">{sub.human_id || `#${sub.id.slice(0, 6)}`}</td>
                                <td className="route-cell">
                                    <span className="table-route">
                                        {sub.payload.source_location_name}
                                        <span className="table-route-arrow"> → </span>
                                        {sub.payload.destination_location_name}
                                    </span>
                                    {sub.payload.is_update && (
                                        <span className="submission-type-badge update" style={{ marginLeft: '8px' }}>
                                            UPDATE
                                        </span>
                                    )}
                                    <RoutePopover sub={sub} />
                                </td>
                                <td className="table-meta">
                                    <div style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {sub.payload.mission_filename}
                                    </div>
                                    <div style={{ fontSize: '10px', opacity: 0.6 }}>Received {timeAgo(sub.created_at)}</div>
                                </td>
                                <td className="table-meta">{sub.payload.network_name}</td>
                                <td>
                                    <ActivityCell sub={sub} />
                                </td>
                                <td>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <StatusBadge 
                                            status={sub.status} 
                                            reason={sub.status_metadata?.rejection_reason || sub.status_metadata?.error} 
                                        />
                                        <WorkflowBadge state={sub.workflow_state} />
                                    </div>
                                </td>
                                <td className="table-meta">
                                    <span className="role-badge" style={{ verticalAlign: 'middle' }}>
                                        {OWNER_MAPPING[sub.workflow_state] || '—'}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
