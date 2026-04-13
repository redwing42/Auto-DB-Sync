import React, { useState, useEffect } from 'react';
import { api } from '../../api/api';
import { Clock, User, CheckCircle, XCircle, Info, Zap, Mail, GitBranch } from 'lucide-react';

const ACTION_ICONS = {
    SUBMISSION_CREATED: { icon: Info, color: 'var(--primary)' },
    GATE1_PASSED: { icon: CheckCircle, color: 'var(--success)' },
    GATE1_FAILED: { icon: XCircle, color: 'var(--danger)' },
    GATE2_CONFIRMED: { icon: CheckCircle, color: 'var(--success)' },
    APPROVED: { icon: Zap, color: 'var(--success)' },
    REJECTED: { icon: XCircle, color: 'var(--danger)' },
    RESUBMITTED: { icon: Clock, color: 'var(--primary)' },
    BRANCH_CREATED: { icon: GitBranch, color: 'var(--primary)' },
    EMAIL_FAILED: { icon: Mail, color: 'var(--danger)' },
    PIPELINE_COMPLETE: { icon: CheckCircle, color: 'var(--success)' },
    PIPELINE_FAILED: { icon: XCircle, color: 'var(--danger)' },
};

export default function ActivityLogTab({ submissionId }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (submissionId) {
            api.getAuditLog(submissionId)
                .then(setLogs)
                .catch(err => console.error('Failed to load logs:', err))
                .finally(() => setLoading(false));
        }
    }, [submissionId]);

    if (loading) {
        return (
            <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 14 }}>
                Loading activity log...
            </div>
        );
    }

    if (logs.length === 0) {
        return (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No activity recorded for this submission
            </div>
        );
    }

    return (
        <div style={{ position: 'relative', padding: '12px' }}>
            {/* Timeline Line */}
            <div style={{ 
                position: 'absolute', left: '27px', top: '24px', bottom: '24px', 
                width: '1px', background: 'var(--border)', zIndex: 0 
            }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {logs.map((log) => {
                    const Config = ACTION_ICONS[log.action_type] || { icon: Info, color: 'var(--text-muted)' };
                    const Icon = Config.icon;
                    const date = new Date(log.timestamp_utc);

                    return (
                        <div key={log.id} style={{ display: 'flex', gap: '16px', position: 'relative', zIndex: 1 }}>
                            <div style={{ 
                                width: '30px', height: '30px', borderRadius: '50%', background: 'var(--surface)', 
                                border: `1px solid ${Config.color}`, display: 'flex', alignItems: 'center', 
                                justifyContent: 'center', flexShrink: 0 
                            }}>
                                <Icon size={16} style={{ color: Config.color }} />
                            </div>
                            
                            <div style={{ flexGrow: 1 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)', textTransform: 'capitalize' }}>
                                        {log.action_type.toLowerCase().replace(/_/g, ' ')}
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                        {date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                                    </div>
                                </div>
                                
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                    <User size={12} />
                                    <span>{log.performed_by_name} ({log.performed_by_role})</span>
                                </div>

                                {log.metadata && Object.keys(log.metadata).length > 0 && (
                                    <div style={{ 
                                        marginTop: '10px', padding: '10px', background: 'var(--bg)', 
                                        borderRadius: '6px', border: '1px solid var(--border)', fontSize: '12px'
                                    }}>
                                        {log.metadata.reason && (
                                            <div style={{ color: 'var(--text-secondary)' }}>
                                                <strong>Reason:</strong> {log.metadata.reason}
                                            </div>
                                        )}
                                        {log.metadata.branch_name && (
                                            <div style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>
                                                git branch: {log.metadata.branch_name}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
