import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { auth } from '../firebase';
import { api } from '../api/api';
import { PlusCircle, RefreshCw, FileText, X } from 'lucide-react';

function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

export default function SubmitPage() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [drafts, setDrafts] = useState([]);
    const [loadingDrafts, setLoadingDrafts] = useState(true);

    // Role guard: only operator and admin
    const canSubmit = user && (user.role === 'operator' || user.role === 'admin');

    useEffect(() => {
        if (!canSubmit) return;
        loadDrafts();
    }, [canSubmit]);

    async function loadDrafts() {
        try {
            const token = await auth.currentUser?.getIdToken();
            if (!token) return;
            const result = await api.listDrafts(token);
            setDrafts(result);
        } catch (err) {
            console.warn('Failed to load drafts:', err);
        } finally {
            setLoadingDrafts(false);
        }
    }

    async function handleDeleteDraft(e, draftId) {
        e.stopPropagation();
        try {
            const token = await auth.currentUser?.getIdToken();
            await api.deleteDraft(draftId, token);
            setDrafts(prev => prev.filter(d => d.id !== draftId));
        } catch (err) {
            console.warn('Failed to delete draft:', err);
        }
    }

    function handleResumeDraft(draft) {
        const path = draft.submission_type === 'UPDATE'
            ? '/submit/update'
            : '/submit/new';
        navigate(`${path}?draft=${draft.id}`);
    }

    if (!canSubmit) {
        return (
            <div>
                <div className="page-header"><h1>Submit Route</h1></div>
                <div className="banner banner-error" style={{
                    padding: '20px', borderRadius: '8px', background: 'var(--danger-bg)',
                    color: 'var(--danger)', border: '1px solid var(--danger)'
                }}>
                    ⚠ You need Operator or Admin role to submit routes.
                </div>
            </div>
        );
    }

    return (
        <div>
            <div className="page-header"><h1>Submit Route</h1></div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', fontSize: '15px' }}>
                Choose a submission type to get started.
            </p>

            <div className="submit-type-grid" id="submit-type-grid">
                <button
                    className="submit-type-card"
                    id="submit-new-route"
                    onClick={() => navigate('/submit/new')}
                >
                    <div className="submit-type-icon submit-type-icon--new">
                        <PlusCircle size={28} />
                    </div>
                    <div className="submit-type-title">New Route</div>
                    <div className="submit-type-desc">
                        Add a brand new flight route with source, destination, waypoints, and Drive files.
                    </div>
                </button>

                <button
                    className="submit-type-card"
                    id="submit-update-route"
                    onClick={() => navigate('/submit/update')}
                >
                    <div className="submit-type-icon submit-type-icon--update">
                        <RefreshCw size={28} />
                    </div>
                    <div className="submit-type-title">Update Existing Route</div>
                    <div className="submit-type-desc">
                        Modify fields on an existing route — see a diff of changes before submitting.
                    </div>
                </button>
            </div>

            {/* Draft Section */}
            {!loadingDrafts && drafts.length > 0 && (
                <div className="draft-section">
                    <div className="draft-section-title">
                        <FileText size={14} />
                        Saved Drafts ({drafts.length})
                    </div>
                    <div className="draft-list">
                        {drafts.map(draft => (
                            <div
                                key={draft.id}
                                className="draft-card"
                                onClick={() => handleResumeDraft(draft)}
                            >
                                <button
                                    className="draft-card-delete"
                                    onClick={(e) => handleDeleteDraft(e, draft.id)}
                                    title="Delete draft"
                                >
                                    <X size={14} />
                                </button>
                                <div className="draft-card-label">{draft.label}</div>
                                <div className="draft-card-meta">
                                    <span className={`draft-card-type ${draft.submission_type === 'UPDATE' ? 'update' : ''}`}>
                                        {draft.submission_type === 'UPDATE' ? 'Update' : 'New'}
                                    </span>
                                    <span>{timeAgo(draft.updated_at || draft.created_at)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {loadingDrafts && (
                <div className="draft-section">
                    <div className="draft-section-title">
                        <FileText size={14} />
                        Saved Drafts
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        {[1, 2].map(i => (
                            <div key={i} className="draft-card" style={{ opacity: 0.5, pointerEvents: 'none' }}>
                                <div className="draft-card-label" style={{
                                    background: 'var(--surface)', height: '16px', width: '60%', borderRadius: '4px'
                                }} />
                                <div className="draft-card-meta" style={{ marginTop: '8px' }}>
                                    <div style={{
                                        background: 'var(--surface)', height: '14px', width: '40px', borderRadius: '3px'
                                    }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
