import React, { useState, useEffect } from 'react';
import { api } from '../../api/api';

function getInitials(name) {
    if (!name) return '?';
    const parts = name.split(' ');
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name[0].toUpperCase();
}

function RelativeTime({ timestamp }) {
    const [text, setText] = useState('');

    useEffect(() => {
        const update = () => {
            const now = new Date();
            const then = new Date(timestamp);
            const diff = Math.max(0, now - then);
            const mins = Math.floor(diff / 60000);
            if (mins < 1) setText('just now');
            else if (mins < 60) setText(`${mins}m ago`);
            else {
                const hrs = Math.floor(mins / 60);
                if (hrs < 24) setText(`${hrs}h ago`);
                else setText(then.toLocaleDateString());
            }
        };
        update();
        const interval = setInterval(update, 60000);
        return () => clearInterval(interval);
    }, [timestamp]);

    return <span>{text}</span>;
}

export default function ActivityLogTab({ submissionId }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchLogs = async () => {
            try {
                const data = await api.getAuditLog(submissionId);
                setLogs(data);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchLogs();
    }, [submissionId]);

    if (loading) return <div className="p-24 text-muted">Loading activity log...</div>;
    if (error) return <div className="banner banner-error">{error}</div>;
    if (logs.length === 0) return <div className="p-24 text-muted">No activity recorded yet.</div>;

    return (
        <div className="activity-timeline">
            {logs.map((log, i) => (
                <div key={log.id} className="timeline-item">
                    <div className="timeline-marker">
                        <div className="avatar-circle">
                            {getInitials(log.performed_by_name || 'System')}
                        </div>
                        {i < logs.length - 1 && <div className="timeline-line" />}
                    </div>
                    <div className="timeline-content">
                        <div className="timeline-header">
                            <span className="actor-name">{log.performed_by_name || 'System'}</span>
                            {log.performed_by_role && (
                                <span className="role-badge">{log.performed_by_role}</span>
                            )}
                            <span className="dot-separator">•</span>
                            <span className="timestamp">
                                <RelativeTime timestamp={log.timestamp_utc} />
                            </span>
                        </div>
                        <div className="action-type">
                            {log.action_type.replace(/_/g, ' ')}
                        </div>
                        {log.metadata && (
                            <div className="log-metadata">
                                {log.metadata.reason && (
                                    <div className="metadata-reason">"{log.metadata.reason}"</div>
                                )}
                                {log.metadata.branch_name && (
                                    <div className="metadata-branch">Branch: <code>{log.metadata.branch_name}</code></div>
                                )}
                                {log.metadata.error && (
                                    <div className="metadata-error">Error: {log.metadata.error}</div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}
