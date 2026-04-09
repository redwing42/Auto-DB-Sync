import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Search, AlertTriangle, Download, Loader2 } from 'lucide-react';
import { api } from '../api/api';
import RequiresRole from '../components/shared/RequiresRole';
import { ROLES } from '../constants';

const TABS = [
    { id: 'users', label: 'User Management' },
    { id: 'features', label: 'Feature Visibility by Role' },
    { id: 'audit', label: 'System Audit Log' },
];

const ROLE_OPTIONS = ['operator', 'reviewer', 'sde', 'admin'];

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

export default function AdminPage() {
    const [activeTab, setActiveTab] = useState('users');

    return (
        <RequiresRole role={ROLES.ADMIN} fallback={
            <div>
                <div className="page-header">
                    <h1>Admin Control Panel</h1>
                </div>
                <div className="banner banner-error">
                    You need Admin access to view this page.
                </div>
            </div>
        }>
            <div>
                <div className="page-header">
                    <div className="flex items-center gap-3">
                        <ShieldCheck size={20} />
                        <h1>Admin Control Panel</h1>
                    </div>
                </div>

                <div className="tabs">
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {activeTab === 'users' && <UserManagementTab />}
                {activeTab === 'features' && <FeatureVisibilityTab />}
                {activeTab === 'audit' && <SystemAuditTab />}
            </div>
        </RequiresRole>
    );
}

function UserManagementTab() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState('');
    const [confirmUser, setConfirmUser] = useState(null);
    const [confirmRole, setConfirmRole] = useState('');

    useEffect(() => {
        let active = true;
        api.getAdminUsers()
            .then((res) => {
                if (!active) return;
                setUsers(res || []);
            })
            .catch((err) => {
                console.error('Failed to load admin users:', err);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    const filteredUsers = useMemo(() => {
        return users.filter((u) => {
            const term = search.trim().toLowerCase();
            if (roleFilter && u.role !== roleFilter) return false;
            if (!term) return true;
            return (
                (u.display_name || '').toLowerCase().includes(term) ||
                (u.email || '').toLowerCase().includes(term)
            );
        });
    }, [users, search, roleFilter]);

    const handleRoleChange = (user, newRole) => {
        if (newRole === user.role) return;
        setConfirmUser(user);
        setConfirmRole(newRole);
    };

    const applyRoleChange = async () => {
        if (!confirmUser || !confirmRole) return;
        try {
            await api.updateAdminUser(confirmUser.uid, { role: confirmRole });
            setUsers((prev) =>
                prev.map((u) =>
                    u.uid === confirmUser.uid ? { ...u, role: confirmRole } : u
                )
            );
        } catch (err) {
            console.error('Failed to update role:', err);
        } finally {
            setConfirmUser(null);
            setConfirmRole('');
        }
    };

    const toggleDeactivate = async (user) => {
        const isInactive = user.status === 'Inactive';
        const updates = { status: isInactive ? 'Active' : 'Inactive' };
        try {
            await api.updateAdminUser(user.uid, updates);
            setUsers((prev) =>
                prev.map((u) =>
                    u.uid === user.uid ? { ...u, status: updates.status } : u
                )
            );
        } catch (err) {
            console.error('Failed to update status:', err);
        }
    };

    return (
        <div className="card">
            <div className="flex items-center gap-4 mb-4">
                <div className="admin-search-input">
                    <Search size={14} className="admin-search-icon" />
                    <input
                        type="text"
                        placeholder="Search by name or email…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <select
                    className="form-select admin-role-filter"
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                >
                    <option value="">All roles</option>
                    {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                            {r}
                        </option>
                    ))}
                </select>
            </div>

            <div className="admin-table-wrapper">
                {loading && (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Email</th>
                                <th>Role</th>
                                <th>Last Login</th>
                                <th>Created</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from({ length: 5 }).map((_, i) => (
                                <tr key={i}>
                                    <td><div className="skeleton h-4 w-32" /></td>
                                    <td><div className="skeleton h-4 w-40" /></td>
                                    <td><div className="skeleton h-4 w-16" /></td>
                                    <td><div className="skeleton h-4 w-24" /></td>
                                    <td><div className="skeleton h-4 w-24" /></td>
                                    <td><div className="skeleton h-4 w-20" /></td>
                                    <td><div className="skeleton h-4 w-24" /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                {!loading && (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Email</th>
                                <th>Role</th>
                                <th>Last Login</th>
                                <th>Account Created</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.map((user) => {
                                const isInactive = user.status === 'Inactive';
                                return (
                                    <tr
                                        key={user.uid}
                                        className={isInactive ? 'admin-row-inactive' : ''}
                                    >
                                        <td>
                                            <div className="admin-user-cell">
                                                <div className="avatar-circle">
                                                    {(user.display_name || user.email || '?')
                                                        .split(' ')
                                                        .map((p) => p[0])
                                                        .join('')
                                                        .toUpperCase()
                                                        .slice(0, 2)}
                                                </div>
                                                <div className="admin-user-text">
                                                    <div className="admin-user-name">
                                                        {user.display_name || 'Unnamed'}
                                                    </div>
                                                    <div className="admin-user-badges">
                                                        {user.is_duplicate && (
                                                            <span className="admin-badge admin-badge-warning">
                                                                DUPLICATE ACCOUNT
                                                            </span>
                                                        )}
                                                        {user.is_external && (
                                                            <span className="admin-badge admin-badge-external">
                                                                EXTERNAL ACCOUNT
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td>{user.email}</td>
                                        <td>
                                            <span className="role-badge">
                                                {user.role}
                                            </span>
                                        </td>
                                        <td>{user.last_login ? timeAgo(user.last_login) : '—'}</td>
                                        <td>{user.created_at ? timeAgo(user.created_at) : '—'}</td>
                                        <td>
                                            <span className={`admin-status-badge ${isInactive ? 'inactive' : 'active'}`}>
                                                {isInactive ? 'INACTIVE' : 'ACTIVE'}
                                            </span>
                                        </td>
                                        <td>
                                            <div className="admin-actions">
                                                <select
                                                    className="form-select admin-role-select"
                                                    value={user.role}
                                                    onChange={(e) =>
                                                        handleRoleChange(user, e.target.value)
                                                    }
                                                >
                                                    {ROLE_OPTIONS.map((r) => (
                                                        <option key={r} value={r}>
                                                            {r}
                                                        </option>
                                                    ))}
                                                </select>
                                                <label className="admin-toggle">
                                                    <input
                                                        type="checkbox"
                                                        checked={!isInactive}
                                                        onChange={() => toggleDeactivate(user)}
                                                    />
                                                    <span />
                                                </label>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {confirmUser && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h3>Change Role</h3>
                        <p>
                            You are changing {confirmUser.display_name || confirmUser.email} from{' '}
                            <strong>{confirmUser.role}</strong> to{' '}
                            <strong>{confirmRole}</strong>. This takes effect immediately.
                        </p>
                        <div className="modal-actions">
                            <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => setConfirmUser(null)}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn btn-danger btn-sm"
                                onClick={applyRoleChange}
                            >
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function FeatureVisibilityTab() {
    const [features, setFeatures] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        api.getFeatureVisibility()
            .then((res) => {
                if (!active) return;
                setFeatures(res || []);
            })
            .catch((err) => {
                console.error('Failed to load feature visibility:', err);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    const updateCell = async (featureId, roleKey, value) => {
        try {
            await api.updateFeatureVisibility(featureId, { [roleKey]: value });
            setFeatures((prev) =>
                prev.map((f) =>
                    f.feature_id === featureId ? { ...f, [roleKey]: value } : f
                )
            );
        } catch (err) {
            console.error('Failed to update visibility:', err);
        }
    };

    return (
        <div className="card">
            <div className="admin-table-wrapper">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Feature</th>
                            <th>Operator</th>
                            <th>Reviewer</th>
                            <th>SDE</th>
                            <th>Admin</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <>
                                {Array.from({ length: 6 }).map((_, i) => (
                                    <tr key={i}>
                                        <td><div className="skeleton h-4 w-40" /></td>
                                        <td><div className="skeleton h-4 w-8" /></td>
                                        <td><div className="skeleton h-4 w-8" /></td>
                                        <td><div className="skeleton h-4 w-8" /></td>
                                        <td><div className="skeleton h-4 w-8" /></td>
                                    </tr>
                                ))}
                            </>
                        )}
                        {!loading &&
                            features.map((f) => (
                                <tr key={f.feature_id}>
                                    <td>{f.label}</td>
                                    <td>
                                        <input
                                            type="checkbox"
                                            checked={!!f.operator}
                                            onChange={(e) =>
                                                updateCell(
                                                    f.feature_id,
                                                    'operator',
                                                    e.target.checked
                                                )
                                            }
                                        />
                                    </td>
                                    <td>
                                        <input
                                            type="checkbox"
                                            checked={!!f.reviewer}
                                            onChange={(e) =>
                                                updateCell(
                                                    f.feature_id,
                                                    'reviewer',
                                                    e.target.checked
                                                )
                                            }
                                        />
                                    </td>
                                    <td>
                                        <input
                                            type="checkbox"
                                            checked={!!f.sde}
                                            onChange={(e) =>
                                                updateCell(
                                                    f.feature_id,
                                                    'sde',
                                                    e.target.checked
                                                )
                                            }
                                        />
                                    </td>
                                    <td>
                                        <input type="checkbox" checked readOnly />
                                    </td>
                                </tr>
                            ))}
                    </tbody>
                </table>
            </div>
            <div className="banner banner-info mt-24">
                <AlertTriangle size={16} />
                <span className="text-sm">
                    Feature visibility controls only hide or show UI elements. All hard role
                    checks on the backend remain in force.
                </span>
            </div>
        </div>
    );
}

function SystemAuditTab() {
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [limit] = useState(50);
    const [total, setTotal] = useState(0);
    const [filters, setFilters] = useState({
        action_type: '',
        uid: '',
        days: 30,
    });

    useEffect(() => {
        let active = true;
        setLoading(true);
        api.getAdminAuditLog({
            page,
            limit,
            action_type: filters.action_type || undefined,
            uid: filters.uid || undefined,
            days: filters.days ?? undefined,
        })
            .then((res) => {
                if (!active) return;
                setRecords(res.records || []);
                setTotal(res.total_count || 0);
            })
            .catch((err) => {
                console.error('Failed to load audit log:', err);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [page, limit, filters.action_type, filters.uid, filters.days]);

    const uniqueUsers = useMemo(() => {
        const map = {};
        records.forEach((r) => {
            if (r.performed_by_uid) {
                map[r.performed_by_uid] = r.performed_by_name || r.performed_by_uid;
            }
        });
        return Object.entries(map);
    }, [records]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return (
        <div className="card">
            <div className="admin-audit-filters">
                <select
                    className="form-select admin-role-filter"
                    value={filters.action_type}
                    onChange={(e) =>
                        setFilters((prev) => ({ ...prev, action_type: e.target.value }))
                    }
                >
                    <option value="">All actions</option>
                    <option value="SUBMISSION_CREATED">SUBMISSION_CREATED</option>
                    <option value="APPROVED">APPROVED</option>
                    <option value="REJECTED">REJECTED</option>
                    <option value="PIPELINE_COMPLETE">PIPELINE_COMPLETE</option>
                    <option value="PIPELINE_FAILED">PIPELINE_FAILED</option>
                </select>
                <select
                    className="form-select admin-role-filter"
                    value={filters.uid}
                    onChange={(e) =>
                        setFilters((prev) => ({ ...prev, uid: e.target.value }))
                    }
                >
                    <option value="">All users</option>
                    {uniqueUsers.map(([uid, name]) => (
                        <option key={uid} value={uid}>
                            {name}
                        </option>
                    ))}
                </select>
                <select
                    className="form-select admin-role-filter"
                    value={filters.days}
                    onChange={(e) =>
                        setFilters((prev) => ({
                            ...prev,
                            days: e.target.value ? Number(e.target.value) : null,
                        }))
                    }
                >
                    <option value="7">Last 7 days</option>
                    <option value="30">Last 30 days</option>
                    <option value="90">Last 90 days</option>
                    <option value="">All time</option>
                </select>
                <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => api.exportAdminAuditLog()}
                >
                    <Download size={14} />
                    Export CSV
                </button>
            </div>

            <div className="admin-table-wrapper">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Timestamp</th>
                            <th>Submission ID</th>
                            <th>Action</th>
                            <th>User</th>
                            <th>Details</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <>
                                {Array.from({ length: 6 }).map((_, i) => (
                                    <tr key={i}>
                                        <td><div className="skeleton h-4 w-40" /></td>
                                        <td><div className="skeleton h-4 w-24" /></td>
                                        <td><div className="skeleton h-4 w-24" /></td>
                                        <td><div className="skeleton h-4 w-32" /></td>
                                        <td><div className="skeleton h-4 w-48" /></td>
                                    </tr>
                                ))}
                            </>
                        )}
                        {!loading &&
                            records.map((r) => (
                                <tr key={r.id}>
                                    <td>
                                        <span title={r.timestamp_utc}>
                                            {timeAgo(r.timestamp_utc)}
                                        </span>
                                    </td>
                                    <td className="table-id">
                                        {r.submission_id || 'System'}
                                    </td>
                                    <td>
                                        <span className="status-badge status-pending">
                                            {r.action_type}
                                        </span>
                                    </td>
                                    <td>{r.performed_by_name || 'System'}</td>
                                    <td>{r.memo}</td>
                                </tr>
                            ))}
                    </tbody>
                </table>
            </div>

            <div className="admin-audit-pagination">
                <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1 || loading}
                >
                    Previous
                </button>
                <span className="text-sm text-muted">
                    Page {page} of {totalPages}
                </span>
                <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages || loading}
                >
                    Next
                </button>
                {loading && <Loader2 className="spin ml-2" size={16} />}
            </div>
        </div>
    );
}

