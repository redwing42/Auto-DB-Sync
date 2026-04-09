import React, { useEffect, useState } from 'react';
import { api } from '../api/api';
import { GitMerge, Search, Filter, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import SubmissionDetail from '../components/submissions/SubmissionDetail';
import RequiresRole from '../components/shared/RequiresRole';
import { ROLES } from '../constants';

function timeAgo(iso) {
    if (!iso) return '';
    const ts = new Date(iso).getTime();
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

const DATE_FILTERS = [
    { label: 'Last 7 days', value: 7 },
    { label: 'Last 30 days', value: 30 },
    { label: 'Last 90 days', value: 90 },
    { label: 'All time', value: null },
];

export default function RouteTrackerPage() {
    const [loading, setLoading] = useState(true);
    const [events, setEvents] = useState([]);
    const [stats, setStats] = useState(null);
    const [filters, setFilters] = useState({
        event_type: '',
        network_id: '',
        days: 30,
        search: '',
    });
    const [searchInput, setSearchInput] = useState('');
    const [expandedId, setExpandedId] = useState(null);
    const [drawerSubmissionId, setDrawerSubmissionId] = useState(null);
    const [networks, setNetworks] = useState([]);

    useEffect(() => {
        let active = true;
        setLoading(true);
        api.getRouteTracker({
            event_type: filters.event_type || undefined,
            network_id: filters.network_id || undefined,
            days: filters.days ?? undefined,
            search: filters.search || undefined,
        })
            .then((res) => {
                if (!active) return;
                setEvents(res.events || []);
                setStats(res.stats || null);
            })
            .catch((err) => {
                console.error('Failed to load route tracker:', err);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [filters.event_type, filters.network_id, filters.days, filters.search]);

    useEffect(() => {
        let active = true;
        api.getNetworks()
            .then((res) => {
                if (!active) return;
                setNetworks(res || []);
            })
            .catch((err) => {
                console.warn('Failed to load networks for filter:', err);
            });
        return () => {
            active = false;
        };
    }, []);

    // Simple debounced search
    useEffect(() => {
        const id = setTimeout(() => {
            setFilters((prev) => ({ ...prev, search: searchInput.trim() }));
        }, 300);
        return () => clearTimeout(id);
    }, [searchInput]);

    const handleFilterClick = (type) => {
        setFilters((prev) => ({
            ...prev,
            event_type: type,
        }));
    };

    const handleDateChange = (value) => {
        setFilters((prev) => ({
            ...prev,
            days: value,
        }));
    };

    const handleNetworkChange = (e) => {
        const value = e.target.value;
        setFilters((prev) => ({
            ...prev,
            network_id: value ? Number(value) : '',
        }));
    };

    const renderChangedFields = (record) => {
        if (!record.changed_fields || Object.keys(record.changed_fields).length === 0) {
            return (
                <div className="rt-diff-empty">
                    No field-level changes recorded for this update.
                </div>
            );
        }
        return (
            <div className="rt-diff-table-wrapper">
                <table className="rt-diff-table">
                    <thead>
                        <tr>
                            <th>Field</th>
                            <th>Old Value</th>
                            <th>New Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        {Object.entries(record.changed_fields).map(([field, value]) => (
                            <tr key={field}>
                                <td>{field}</td>
                                <td>{value.old ?? '—'}</td>
                                <td>{value.new ?? '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };

    const renderNewRoutePayload = (record) => {
        const p = record.payload || {};
        return (
            <div className="rt-diff-grid">
                <div>
                    <div className="rt-diff-label">Network</div>
                    <div className="rt-diff-value">{p.network_name || '—'}</div>
                </div>
                <div>
                    <div className="rt-diff-label">Source</div>
                    <div className="rt-diff-value">
                        {p.source_location_name || '—'} · {p.source_takeoff_zone_name || '—'}
                    </div>
                </div>
                <div>
                    <div className="rt-diff-label">Destination</div>
                    <div className="rt-diff-value">
                        {p.destination_location_name || '—'} · {p.destination_landing_zone_name || '—'}
                    </div>
                </div>
                <div>
                    <div className="rt-diff-label">Mission File</div>
                    <div className="rt-diff-value mono">{p.mission_filename || '—'}</div>
                </div>
            </div>
        );
    };

    return (
        <RequiresRole role={ROLES.SDE} fallback={
            <div>
                <div className="page-header">
                    <h1>Route Update Tracker</h1>
                </div>
                <div className="banner banner-error">
                    You need SDE or Admin access to view the Route Tracker.
                </div>
            </div>
        }>
            <div className="rt-page">
                <div className="page-header">
                    <div className="rt-header-left">
                        <div className="rt-title-row">
                            <GitMerge size={20} />
                            <h1>Route Update Tracker</h1>
                        </div>
                        <p className="rt-subtitle">
                            Authoritative history of every route inserted or updated in flights.db and pushed to aircraft systems.
                        </p>
                    </div>
                </div>

                <div className="rt-layout">
                    <div className="rt-main">
                        <div className="rt-filters card">
                            <div className="rt-filters-top">
                                <div className="rt-filter-group">
                                    <button
                                        className={`rt-pill ${!filters.event_type ? 'active' : ''}`}
                                        onClick={() => handleFilterClick('')}
                                    >
                                        All
                                    </button>
                                    <button
                                        className={`rt-pill ${filters.event_type === 'NEW_ROUTE' ? 'active' : ''}`}
                                        onClick={() => handleFilterClick('NEW_ROUTE')}
                                    >
                                        New Routes
                                    </button>
                                    <button
                                        className={`rt-pill ${filters.event_type === 'UPDATE' ? 'active' : ''}`}
                                        onClick={() => handleFilterClick('UPDATE')}
                                    >
                                        Updates
                                    </button>
                                </div>
                                <div className="rt-filter-group">
                                    <div className="rt-select-wrapper">
                                        <Filter size={14} className="rt-select-icon" />
                                        <select
                                            className="form-select rt-select"
                                            value={filters.network_id}
                                            onChange={handleNetworkChange}
                                        >
                                            <option value="">All networks</option>
                                            {networks.map((n) => (
                                                <option key={n.id} value={n.id}>
                                                    {n.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="rt-date-filters">
                                        {DATE_FILTERS.map((opt) => (
                                            <button
                                                key={opt.label}
                                                className={`rt-pill rt-pill-small ${
                                                    filters.days === opt.value ? 'active' : ''
                                                }`}
                                                onClick={() => handleDateChange(opt.value)}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <div className="rt-search-row">
                                <div className="rt-search-input">
                                    <Search size={14} className="rt-search-icon" />
                                    <input
                                        type="text"
                                        placeholder="Search by route or submission ID (RW-XX)…"
                                        value={searchInput}
                                        onChange={(e) => setSearchInput(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="rt-timeline card custom-scrollbar">
                            {loading && (
                                <div className="rt-timeline-skeleton">
                                    {Array.from({ length: 5 }).map((_, i) => (
                                        <div key={i} className="rt-event-skeleton">
                                            <div className="skeleton rt-event-skel-line rt-event-skel-line-1" />
                                            <div className="skeleton rt-event-skel-line rt-event-skel-line-2" />
                                        </div>
                                    ))}
                                </div>
                            )}

                            {!loading && events.length === 0 && (
                                <div className="empty-state">
                                    <p>No route pushes found for this filter.</p>
                                </div>
                            )}

                            {!loading && events.length > 0 && (
                                <ul className="rt-event-list">
                                    {events.map((ev) => {
                                        const isNew = ev.event_type === 'NEW ROUTE';
                                        const isExpanded = expandedId === ev.id;
                                        return (
                                            <li key={ev.id} className="rt-event-item">
                                                <div className="rt-event-header">
                                                    <div className="rt-event-main">
                                                        <span
                                                            className={`rt-badge ${
                                                                isNew ? 'rt-badge-success' : 'rt-badge-amber'
                                                            }`}
                                                        >
                                                            {ev.event_type}
                                                        </span>
                                                        <span className="rt-route">
                                                            {ev.route}
                                                        </span>
                                                        <span className="rt-network">
                                                            {ev.network || 'Unknown network'}
                                                        </span>
                                                    </div>
                                                    <div className="rt-event-meta">
                                                        <button
                                                            className="rt-link-id"
                                                            onClick={() => setDrawerSubmissionId(ev.submission_id)}
                                                        >
                                                            {ev.human_id}
                                                        </button>
                                                        {ev.branch_name && (
                                                            <code className="rt-branch">
                                                                {ev.branch_name}
                                                            </code>
                                                        )}
                                                        <span
                                                            className={`rt-sync-badge ${
                                                                ev.is_merged ? 'rt-sync-ok' : 'rt-sync-pending'
                                                            }`}
                                                        >
                                                            {ev.is_merged ? 'SYNCED' : 'PENDING SYNC'}
                                                        </span>
                                                        <div className="rt-user-chip">
                                                            <div className="rt-avatar">
                                                                {(ev.performed_by_name || '?')
                                                                    .split(' ')
                                                                    .map((p) => p[0])
                                                                    .join('')
                                                                    .toUpperCase()
                                                                    .slice(0, 2)}
                                                            </div>
                                                            <div className="rt-user-meta">
                                                                <span className="rt-user-name">
                                                                    {ev.performed_by_name || 'Unknown'}
                                                                </span>
                                                                <span className="rt-role-badge">
                                                                    {ev.performed_by_role || 'unknown'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className="rt-timestamp">
                                                            <Clock size={12} />
                                                            <span title={ev.timestamp}>
                                                                {timeAgo(ev.timestamp)}
                                                            </span>
                                                        </div>
                                                        <button
                                                            className="btn btn-sm btn-ghost rt-expand-btn"
                                                            onClick={() =>
                                                                setExpandedId(isExpanded ? null : ev.id)
                                                            }
                                                        >
                                                            {isExpanded ? (
                                                                <>
                                                                    Hide diff <ChevronUp size={14} />
                                                                </>
                                                            ) : (
                                                                <>
                                                                    View diff <ChevronDown size={14} />
                                                                </>
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                                {isExpanded && (
                                                    <div className="rt-event-body">
                                                        {isNew
                                                            ? renderNewRoutePayload(ev)
                                                            : renderChangedFields(ev)}
                                                    </div>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </div>

                    <aside className="rt-stats card">
                        <div className="rt-stats-header">
                            <h2>Stats this month</h2>
                        </div>
                        {!stats && (
                            <div className="rt-stats-skeleton">
                                <div className="skeleton rt-stat-skel" />
                                <div className="skeleton rt-stat-skel" />
                                <div className="skeleton rt-stat-skel" />
                            </div>
                        )}
                        {stats && (
                            <>
                                <div className="rt-stat-grid">
                                    <div className="rt-stat-card">
                                        <div className="rt-stat-label">Total routes pushed</div>
                                        <div className="rt-stat-value">
                                            {stats.total_pushed_this_month}
                                        </div>
                                    </div>
                                    <div className="rt-stat-card">
                                        <div className="rt-stat-label">New routes</div>
                                        <div className="rt-stat-value">
                                            {stats.new_routes_this_month}
                                        </div>
                                    </div>
                                    <div className="rt-stat-card">
                                        <div className="rt-stat-label">Route updates</div>
                                        <div className="rt-stat-value">
                                            {stats.updates_this_month}
                                        </div>
                                    </div>
                                </div>
                                <div className="rt-stat-section">
                                    <div className="rt-stat-label">Most active network</div>
                                    <div className="rt-stat-value-sm">
                                        {stats.most_active_network_month || '—'}
                                    </div>
                                </div>
                                <div className="rt-stat-section">
                                    <div className="rt-stat-label">Last push</div>
                                    {stats.last_push ? (
                                        <div className="rt-last-push">
                                            <div className="rt-last-line mono">
                                                {stats.last_push.branch_name || '—'}
                                            </div>
                                            <div className="rt-last-meta">
                                                <span>
                                                    {stats.last_push.performed_by_name || 'Unknown'} ·{' '}
                                                    {stats.last_push.performed_by_role || 'unknown'}
                                                </span>
                                                <span title={stats.last_push.timestamp}>
                                                    {timeAgo(stats.last_push.timestamp)}
                                                </span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="rt-stat-value-sm">No pushes yet</div>
                                    )}
                                </div>
                                <div className="rt-stat-section">
                                    <div className="rt-stat-label">Pushes per week (last 8)</div>
                                    <div className="rt-bar-chart">
                                        {(stats.weekly_pushes || []).map((v, idx) => (
                                            <div key={idx} className="rt-bar-wrapper">
                                                <div
                                                    className={`rt-bar ${v > 0 ? 'rt-bar-active' : ''}`}
                                                    style={{ '--rt-bar-value': v }}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                    </aside>
                </div>

                {drawerSubmissionId && (
                    <div className="rt-drawer-overlay" onClick={() => setDrawerSubmissionId(null)}>
                        <div
                            className="rt-drawer"
                            onClick={(e) => {
                                e.stopPropagation();
                            }}
                        >
                            <div className="rt-drawer-header">
                                <h2>Submission Details</h2>
                                <button
                                    className="btn btn-sm btn-ghost"
                                    onClick={() => setDrawerSubmissionId(null)}
                                >
                                    Close
                                </button>
                            </div>
                            <div className="rt-drawer-body custom-scrollbar">
                                <SubmissionDetail
                                    id={drawerSubmissionId}
                                    embedded
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </RequiresRole>
    );
}

