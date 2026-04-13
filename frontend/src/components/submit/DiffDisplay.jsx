import React from 'react';

/**
 * Enhanced diff display for the Update Route flow.
 * Shows old→new field changes with Tailwind v4 accent highlights.
 * Supports numeric deltas for coordinate/direction fields.
 */

const NUMERIC_FIELDS = new Set([
    'source_latitude', 'source_longitude',
    'destination_latitude', 'destination_longitude',
    'takeoff_direction', 'approach_direction',
]);

function formatDelta(field, oldVal, newVal) {
    if (!NUMERIC_FIELDS.has(field)) return null;
    const delta = parseFloat(newVal) - parseFloat(oldVal);
    if (isNaN(delta)) return null;
    const sign = delta >= 0 ? '+' : '';
    return `${sign}${delta.toFixed(field.includes('direction') ? 0 : 6)}`;
}

export default function DiffDisplay({ label, field, oldValue, newValue, compact = false }) {
    const hasChanged = String(oldValue) !== String(newValue);

    if (!hasChanged) {
        return (
            <div className="diff-row">
                <span className="diff-label">{label}</span>
                <span className="diff-value diff-unchanged">{String(newValue)}</span>
            </div>
        );
    }

    const delta = formatDelta(field, oldValue, newValue);

    if (compact) {
        return (
            <div className="diff-row diff-changed diff-compact">
                <span className="diff-label">{label}</span>
                <span className="diff-value-inline">
                    <span className="diff-old">{String(oldValue)}</span>
                    <span className="diff-arrow">→</span>
                    <span className="diff-new">{String(newValue)}</span>
                    {delta && <span className="diff-delta">({delta})</span>}
                </span>
            </div>
        );
    }

    return (
        <div className="diff-row diff-changed">
            <span className="diff-label">{label}</span>
            <div className="diff-values">
                <div className="diff-cell diff-cell-old">
                    <span className="diff-cell-tag">Before</span>
                    <span className="diff-old">{String(oldValue)}</span>
                </div>
                <span className="diff-arrow">→</span>
                <div className="diff-cell diff-cell-new">
                    <span className="diff-cell-tag">After</span>
                    <span className="diff-new">{String(newValue)}</span>
                </div>
                {delta && (
                    <span className="diff-delta">{delta}</span>
                )}
            </div>
        </div>
    );
}

/**
 * Summary card showing all changed fields at a glance.
 */
export function DiffSummary({ changedFields }) {
    if (!changedFields || Object.keys(changedFields).length === 0) {
        return (
            <div className="diff-summary diff-summary-empty">
                <span className="diff-summary-icon">○</span>
                No fields changed
            </div>
        );
    }

    const count = Object.keys(changedFields).length;

    return (
        <div className="diff-summary">
            <div className="diff-summary-header">
                <span className="diff-summary-icon">◉</span>
                <span className="diff-summary-count">{count} field{count !== 1 ? 's' : ''} changed</span>
            </div>
            <div className="diff-summary-list">
                {Object.entries(changedFields).map(([field, { old: oldVal, new: newVal }]) => (
                    <DiffDisplay
                        key={field}
                        label={fieldToLabel(field)}
                        field={field}
                        oldValue={oldVal}
                        newValue={newVal}
                        compact
                    />
                ))}
            </div>
        </div>
    );
}

function fieldToLabel(field) {
    return field
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}
