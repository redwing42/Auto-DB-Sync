import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, BarChart3, Map, MapPin, PlusCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const NAV_ITEMS = [
    {
        section: 'Submissions',
        items: [
            { label: 'All', path: '/', filter: null },
            { label: 'Pending', path: '/?status=pending', filter: 'pending' },
            { label: 'Approved', path: '/?status=approved', filter: 'approved' },
            { label: 'Rejected', path: '/?status=rejected', filter: 'rejected' },
            { label: 'Failed', path: '/?status=failed', filter: 'failed' },
        ],
    },
    {
        section: 'Tools',
        items: [
            { label: 'DB Stats', path: '/stats', icon: BarChart3 },
            { label: 'WP Viewer', path: '/viewer', icon: Map },
            { label: 'LZ Management', path: '/lz-management', icon: MapPin },
        ],
    },
];

export default function Sidebar({ pendingCount = 0 }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { user } = useAuth();

    const canSubmit = user && (user.role === 'operator' || user.role === 'admin');

    const isActive = (item) => {
        if (item.filter !== undefined) {
            const params = new URLSearchParams(location.search);
            const currentFilter = params.get('status');
            if (item.filter === null && !currentFilter && location.pathname === '/') return true;
            return currentFilter === item.filter && location.pathname === '/';
        }
        return location.pathname === item.path;
    };

    return (
        <nav className="sidebar">
            {/* Actions section — operator/admin only */}
            {canSubmit && (
                <div className="sidebar-section">
                    <div className="sidebar-section-title">Actions</div>
                    <a
                        className={`sidebar-item ${location.pathname.startsWith('/submit') ? 'active' : ''}`}
                        onClick={(e) => { e.preventDefault(); navigate('/submit'); }}
                        href="/submit"
                    >
                        <PlusCircle size={16} />
                        New Submission
                    </a>
                </div>
            )}

            {NAV_ITEMS.map((group) => (
                <div key={group.section} className="sidebar-section">
                    <div className="sidebar-section-title">{group.section}</div>
                    {group.items.map((item) => (
                        <a
                            key={item.label}
                            className={`sidebar-item ${isActive(item) ? 'active' : ''}`}
                            onClick={(e) => {
                                e.preventDefault();
                                navigate(item.path);
                            }}
                            href={item.path}
                        >
                            {item.icon && <item.icon size={16} />}
                            {item.label}
                            {item.label === 'Pending' && pendingCount > 0 && (
                                <span className="sidebar-badge">{pendingCount}</span>
                            )}
                        </a>
                    ))}
                </div>
            ))}
        </nav>
    );
}

