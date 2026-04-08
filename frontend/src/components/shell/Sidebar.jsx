import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { 
    LayoutDashboard, 
    BarChart3, 
    MapPin, 
    PlusCircle, 
    ChevronLeft, 
    ChevronRight, 
    Globe,
    LayoutList,
    Clock,
    CheckCircle,
    XCircle,
    AlertTriangle
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const NAV_ITEMS = [
    {
        section: 'Overview',
        items: [
            { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
            { label: 'Network Map', path: '/network-map', icon: Globe },
        ]
    },
    {
        section: 'Submissions',
        items: [
            { label: 'All', path: '/submissions', icon: LayoutList, filter: null, iconColor: 'var(--text-secondary)' },
            { label: 'Pending', path: '/submissions?status=pending', icon: Clock, filter: 'pending', iconColor: 'var(--warning)' },
            { label: 'Approved', path: '/submissions?status=approved', icon: CheckCircle, filter: 'approved', iconColor: 'var(--success)' },
            { label: 'Rejected', path: '/submissions?status=rejected', icon: XCircle, filter: 'rejected', iconColor: 'var(--danger)' },
            { label: 'Failed', path: '/submissions?status=failed', icon: AlertTriangle, filter: 'failed', iconColor: 'var(--caution)' },
        ],
    },
    {
        section: 'Tools',
        items: [
            { label: 'Database Health', path: '/stats', icon: BarChart3 },
            { label: 'LZ Management', path: '/lz-management', icon: MapPin },
        ],
    },
];

export default function Sidebar({ pendingCount = 0, collapsed, setCollapsed }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { user } = useAuth();

    const ROLE_LEVELS = {
        'operator': 1,
        'reviewer': 2,
        'sde': 3,
        'admin': 4
    };
    const userRole = user?.role?.toLowerCase() || 'operator';
    const canSubmit = (ROLE_LEVELS[userRole] || 0) >= 1;

    const isActive = (item) => {
        if (item.filter !== undefined) {
            const params = new URLSearchParams(location.search);
            const currentFilter = params.get('status');
            if (item.filter === null && !currentFilter && location.pathname === '/submissions') return true;
            return currentFilter === item.filter && location.pathname === '/submissions';
        }
        return location.pathname === item.path;
    };

    return (
        <nav className="sidebar">
            <div className="sidebar-content" style={{ flex: 1 }}>
                {/* Actions section — permitted roles only */}
                {canSubmit && (
                    <div className="sidebar-section">
                        {!collapsed && <div className="sidebar-section-title">Actions</div>}
                        <a
                            className={`sidebar-item ${location.pathname.startsWith('/submit') ? 'active' : ''}`}
                            onClick={(e) => { e.preventDefault(); navigate('/submit'); }}
                            href="/submit"
                            title={collapsed ? "New Submission" : ""}
                        >
                            <PlusCircle size={18} />
                            <span>New Submission</span>
                        </a>
                    </div>
                )}

                {NAV_ITEMS.map((group) => (
                    <div key={group.section} className="sidebar-section">
                        {!collapsed && <div className="sidebar-section-title">{group.section}</div>}
                        {group.items.map((item) => (
                            <a
                                key={item.label}
                                className={`sidebar-item ${isActive(item) ? 'active' : ''}`}
                                onClick={(e) => {
                                    e.preventDefault();
                                    navigate(item.path);
                                }}
                                href={item.path}
                                title={collapsed ? item.label : ""}
                                style={{ position: 'relative' }}
                            >
                                {item.icon && <item.icon size={18} style={item.iconColor ? { color: item.iconColor } : undefined} />}
                                <span>{item.label}</span>
                                {item.label === 'Pending' && pendingCount > 0 && (
                                    <span className="sidebar-badge">{pendingCount}</span>
                                )}
                            </a>
                        ))}
                    </div>
                ))}
            </div>

            <div className="sidebar-footer">
                <button 
                    className="btn-toggle-sidebar"
                    onClick={() => setCollapsed(!collapsed)}
                    title={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
                >
                    {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                </button>
            </div>
        </nav>
    );
}
