/**
 * API service for RedWing DB Automation backend.
 *
 * All calls go through authFetch() — currently a no-op wrapper.
 * When Firebase is added, only authFetch needs updating to attach
 * the Authorization header.
 */

const API_BASE = import.meta.env.VITE_API_URL || '/api';

import { auth } from '../firebase';

const authFetch = async (url, options = {}) => {
    let token = null;
    try {
        token = await auth.currentUser?.getIdToken(false); // false = use cached token
    } catch (err) {
        console.warn('Could not get auth token:', err);
    }

    const headers = {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        ...options.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {})
    };

    const response = await fetch(`${import.meta.env.VITE_API_URL || '/api'}${url}`, {
        ...options,
        headers
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
    }

    return response.json();
};

export const api = {
    // ── Submissions ─────────────────────────────────────────────────────
    listSubmissions: () => authFetch('/submissions'),
    getSubmission: (id) => authFetch(`/submissions/${id}`),

    updateStatus: (id, status, reason) =>
        authFetch(`/submissions/${id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status, reason }),
        }),

    rejectSubmission: (id, reason) =>
        authFetch(`/submissions/${id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'rejected', reason }),
        }),

    markAsDuplicate: (id) =>
        authFetch(`/submissions/${id}/mark-duplicate`, {
            method: 'PATCH',
        }),

    markDuplicateWithId: (id, duplicateOf, reason) =>
        authFetch(`/submissions/${id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({
                status: 'duplicate',
                duplicate_of: duplicateOf,
                reason,
            }),
        }),

    // ── Files ───────────────────────────────────────────────────────────
    downloadFiles: (id) =>
        authFetch(`/submissions/${id}/download-files`, { method: 'POST' }),

    // ── Waypoints ───────────────────────────────────────────────────────
    getWaypointData: (id) => authFetch(`/submissions/${id}/waypoint-data`),

    // ── Preview ─────────────────────────────────────────────────────────
    getResolvePreview: (id) => authFetch(`/submissions/${id}/resolve-preview`),

    // ── Approve ─────────────────────────────────────────────────────────
    approveSubmission: (id, confirmedNewEntities) =>
        authFetch(`/submissions/${id}/approve`, {
            method: 'POST',
            body: JSON.stringify({ confirmed_new_entities: confirmedNewEntities }),
        }),

    // ── Review State ────────────────────────────────────────────────────
    updateReviewState: (id, { waypoint_verified, id_resolution_reviewed }) =>
        authFetch(`/submissions/${id}/review-state`, {
            method: 'PATCH',
            body: JSON.stringify({ waypoint_verified, id_resolution_reviewed }),
        }),

    // ── Pipeline Status ─────────────────────────────────────────────────
    getPipelineStatus: (id) =>
        authFetch(`/submissions/${id}/pipeline-status`),

    // ── Stats ───────────────────────────────────────────────────────────
    getStats: () => authFetch('/stats'),

    // ── Config ──────────────────────────────────────────────────────────
    getCesiumToken: () => authFetch('/config/cesium-token'),

    // ── Submit (Phase 2) ────────────────────────────────────────────────
    createSubmission: (payload) =>
        authFetch('/submissions', {
            method: 'POST',
            body: JSON.stringify(payload),
        }),

    validateSubmission: (payload) =>
        authFetch('/submissions/validate', {
            method: 'POST',
            body: JSON.stringify(payload),
        }),

    checkDuplicate: (payload) =>
        authFetch('/submissions/check-duplicate', {
            method: 'POST',
            body: JSON.stringify(payload),
        }),

    // ── Networks & Routes ───────────────────────────────────────────────
    getNetworks: () => authFetch('/networks'),
    getNetworkRoutes: (networkId) => authFetch(`/networks/${networkId}/routes`),
    getRoute: (routeId) => authFetch(`/routes/${routeId}`),
    getNetworkLandingZones: (networkId) => authFetch(`/networks/${networkId}/landing-zones`),

    // ── Waypoint File Parsing ────────────────────────────────────────────
    parseWaypoints: async (file) => {
        let token = null;
        try { token = await auth.currentUser?.getIdToken(false); } catch {}
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/waypoints/parse`, {
            method: 'POST',
            headers: {
                'ngrok-skip-browser-warning': 'true',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: formData,
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({ detail: response.statusText }));
            throw new Error(err.detail || `HTTP ${response.status}`);
        }
        return response.json();
    },
};
