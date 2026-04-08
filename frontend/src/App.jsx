import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './components/shared/Toast';
import AppShell from './components/shell/AppShell';
import InboxPage from './pages/InboxPage';
import DashboardPage from './pages/DashboardPage';
import NetworkMapPage from './pages/NetworkMapPage';
import SubmissionDetail from './components/submissions/SubmissionDetail';
import StatsPage from './pages/StatsPage';
import ViewerPage from './pages/ViewerPage';
import LoginPage from './components/auth/LoginPage';
import SubmitPage from './pages/SubmitPage';
import NewRouteStepper from './components/submit/NewRouteStepper';
import UpdateRouteStepper from './components/submit/UpdateRouteStepper';
import LZManagementTab from './components/lz_management/LZManagementTab';

function AppContent() {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div style={{
                height: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'Barlow, sans-serif',
                color: 'var(--text-secondary)',
                fontSize: '14px',
                background: 'var(--bg)'
            }}>
                Loading RedWing Ops...
            </div>
        );
    }

    if (!user) return <LoginPage />;

    return (
        <AppShell>
            <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/submissions" element={<InboxPage />} />
                <Route path="/submissions/:id" element={<SubmissionDetail />} />
                <Route path="/network-map" element={<NetworkMapPage />} />
                <Route path="/stats" element={<StatsPage />} />
                <Route path="/viewer" element={<ViewerPage />} />
                <Route path="/submit" element={<SubmitPage />} />
                <Route path="/submit/new" element={<NewRouteStepper />} />
                <Route path="/submit/update" element={<UpdateRouteStepper />} />
                <Route path="/lz-management" element={<LZManagementTab />} />
            </Routes>
        </AppShell>
    );
}

export default function App() {
    return (
        <ToastProvider>
            <AuthProvider>
                <AppContent />
            </AuthProvider>
        </ToastProvider>
    );
}
