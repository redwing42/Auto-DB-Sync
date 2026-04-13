import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PlusCircle, RefreshCw } from 'lucide-react';

export default function SubmitPage() {
    const navigate = useNavigate();
    const { user } = useAuth();

    // Role guard: only operator and admin
    const canSubmit = user && (user.role === 'operator' || user.role === 'admin');

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
        </div>
    );
}
