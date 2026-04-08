import React from 'react';

/**
 * Inline indicator showing draft auto-save status.
 * Place in the stepper header or footer.
 */
export default function DraftSaveIndicator({ saving, lastSaved }) {
    const statusClass = saving ? 'saving' : lastSaved ? 'saved' : '';
    const label = saving
        ? 'Saving draft…'
        : lastSaved
            ? `Draft saved ${formatTime(lastSaved)}`
            : 'Not saved';

    return (
        <div className={`draft-save-indicator ${statusClass}`}>
            <span className="draft-save-dot" />
            <span>{label}</span>
        </div>
    );
}

function formatTime(date) {
    if (!date) return '';
    const now = new Date();
    const diff = now - date;
    if (diff < 5000) return 'just now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
