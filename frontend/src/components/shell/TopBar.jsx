import React, { useState } from 'react';
import { Search, Sun, Moon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';

export default function TopBar() {
    const { user, logout } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const [query, setQuery] = useState('');
    const [showMenu, setShowMenu] = useState(false);

    return (
        <header className="topbar">
            <div className="topbar-brand">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18l6-6-6-6" />
                </svg>
                RedWing Ops
            </div>

            <div className="topbar-search">
                <Search size={16} />
                <input
                    type="text"
                    placeholder="Search submissions..."
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                />
            </div>

            <div className="topbar-actions">
                <button 
                  onClick={toggleTheme}
                  className="btn-theme-toggle"
                  title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
                >
                  {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
                </button>

                <div style={{ position: 'relative' }}>
                    <img
                        src={user?.photoURL || 'https://www.google.com/favicon.ico'}
                        referrerPolicy="no-referrer"
                        style={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            cursor: 'pointer',
                            border: '2px solid #E5E7EB'
                        }}
                        onClick={() => setShowMenu(!showMenu)}
                        title={user?.displayName || user?.email}
                    />
                    {showMenu && (
                        <div style={{
                            position: 'absolute',
                            right: 0,
                            top: '40px',
                            background: 'white',
                            border: '1px solid #E5E7EB',
                            borderRadius: '8px',
                            padding: '8px',
                            minWidth: '200px',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                            zIndex: 100
                        }}>
                            <div style={{ padding: '8px 12px', borderBottom: '1px solid #E5E7EB', marginBottom: '4px' }}>
                                <div style={{ fontSize: '13px', fontWeight: 500, color: '#111827' }}>
                                    {user?.displayName}
                                </div>
                                <div style={{ fontSize: '12px', color: '#6B7280' }}>{user?.email}</div>
                                <div style={{
                                    fontSize: '11px',
                                    fontFamily: 'Barlow Condensed, sans-serif',
                                    fontWeight: 600,
                                    color: '#2563EB',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.06em',
                                    marginTop: '4px'
                                }}>
                                    {user?.role}
                                </div>
                            </div>
                            <button
                                onClick={logout}
                                style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    background: 'none',
                                    border: 'none',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    fontSize: '13px',
                                    color: '#DC2626',
                                    borderRadius: '4px',
                                    fontFamily: 'Barlow, sans-serif'
                                }}
                            >
                                Sign out
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}
