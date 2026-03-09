/**
 * API service for RedWing DB Automation backend.
 */

const API_BASE = '/api';

async function request(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
}

export const api = {
    // Submissions
    listSubmissions: () => request('/submissions'),
    getSubmission: (id) => request(`/submissions/${id}`),
    rejectSubmission: (id, reason) =>
        request(`/submissions/${id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'rejected', reason }),
        }),
    markAsDuplicate: (id) =>
        request(`/submissions/${id}/mark-duplicate`, {
            method: 'PATCH',
        }),

    // Files
    downloadFiles: (id) =>
        request(`/submissions/${id}/download-files`, { method: 'POST' }),

    // Waypoints
    getWaypointData: (id) => request(`/submissions/${id}/waypoint-data`),

    // Preview
    getResolvePreview: (id) => request(`/submissions/${id}/resolve-preview`),

    // Approve
    approveSubmission: (id, confirmedNewEntities) =>
        request(`/submissions/${id}/approve`, {
            method: 'POST',
            body: JSON.stringify({ confirmed_new_entities: confirmedNewEntities }),
        }),

    // Config
    getCesiumToken: () => request('/config/cesium-token'),
};
