import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import TopBar from './TopBar';
import Sidebar from './Sidebar';
import { ThemeProvider } from '../../context/ThemeContext';

export default function AppShell({ children }) {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
        return localStorage.getItem('sidebar_collapsed') === 'true';
    });
    const location = useLocation();

    // Persist sidebar state
    useEffect(() => {
        localStorage.setItem('sidebar_collapsed', sidebarCollapsed);
    }, [sidebarCollapsed]);

    // Auto-collapse on submission detail
    useEffect(() => {
        if (location.pathname.startsWith('/submissions/')) {
            setSidebarCollapsed(true);
        }
    }, [location.pathname]);

    return (
        <ThemeProvider>
            <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
                <TopBar />
                <div className="app-body">
                    <Sidebar collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} />
                    <main className="app-main">
                        {children}
                    </main>
                </div>
            </div>
        </ThemeProvider>
    );
}
