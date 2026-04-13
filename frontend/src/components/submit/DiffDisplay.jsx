import React from 'react';

/**
 * Displays old→new field changes for the Update Route flow.
 */
export default function DiffDisplay({ label, oldValue, newValue }) {
    const hasChanged = String(oldValue) !== String(newValue);

    if (!hasChanged) {
        return (
            <div className="diff-row">
                <span className="diff-label">{label}</span>
                <span className="diff-value">{String(newValue)}</span>
            </div>
        );
    }

    return (
        <div className="diff-row diff-changed">
            <span className="diff-label">{label}</span>
            <div className="diff-values">
                <span className="diff-old">{String(oldValue)}</span>
                <span className="diff-arrow">→</span>
                <span className="diff-new">{String(newValue)}</span>
            </div>
        </div>
    );
}
