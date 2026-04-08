/**
 * API service for RedWing DB Automation backend.
 *
 * All calls go through authFetch() — currently a no-op wrapper.
 * When Firebase is added, only authFetch needs updating to attach
 * the Authorization header.
 */

const API_BASE = import.meta.env.VITE_API_URL || '/api';

import { auth } from '../firebase';

/** Headers for manual fetch calls that take a pre-fetched token. */
const jsonHeaders = (token) => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

/** Extract error detail from a non-ok Response. */
const apiError = async (response) => {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    return new Error(body.detail || `HTTP ${response.status}`);
};

const authFetch = async (url, options = {}) => {
    let token = null;
    try {
        token = await auth.currentUser?.getIdToken(false); // false = use cached token
    } catch (err) {
        console.warn('Could not get auth token:', err);
    }

    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {})
    };

    let finalUrl = `${import.meta.env.VITE_API_URL || '/api'}${url}`;
    if (!options.method || options.method === 'GET') {
        const separator = finalUrl.includes('?') ? '&' : '?';
        finalUrl += `${separator}t=${Date.now()}`;
    }

    const response = await fetch(finalUrl, {
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
    getLocations: () => authFetch('/locations'),
    createLandingZone: (networkId, payload) => authFetch(`/networks/${networkId}/landing-zones`, {
        method: 'POST',
        body: JSON.stringify(payload),
    }),
    updateLandingZone: (lzId, payload) => authFetch(`/landing-zones/${lzId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
    }),

    deleteLandingZone: (lzId) => authFetch(`/landing-zones/${lzId}`, {
        method: 'DELETE',
    }),

    getAuditLog: (submissionId) => authFetch(`/submissions/${submissionId}/audit`),

    // ── Waypoint File Parsing ────────────────────────────────────────────
    parseWaypoints: async (file) => {
        let token = null;
        try { token = await auth.currentUser?.getIdToken(false); } catch {}
        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/waypoints/parse`, {
            method: 'POST',
            headers: {
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

    // ── Phase 4: Draft CRUD ─────────────────────────────────────────────

    async saveDraft(draftData, token) {
        const response = await fetch(`${API_BASE}/drafts`, {
            method: 'POST',
            headers: jsonHeaders(token),
            body: JSON.stringify(draftData),
        });
        if (!response.ok) throw await apiError(response);
        return response.json();
    },

    async listDrafts(token) {
        const response = await fetch(`${API_BASE}/drafts`, {
            headers: jsonHeaders(token),
        });
        if (!response.ok) throw await apiError(response);
        return response.json();
    },

    async getDraft(draftId, token) {
        const response = await fetch(`${API_BASE}/drafts/${draftId}`, {
            headers: jsonHeaders(token),
        });
        if (!response.ok) throw await apiError(response);
        return response.json();
    },

    async deleteDraft(draftId, token) {
        const response = await fetch(`${API_BASE}/drafts/${draftId}`, {
            method: 'DELETE',
            headers: jsonHeaders(token),
        });
        if (!response.ok) throw await apiError(response);
        return response.json();
    },

    // ── Phase 4: Resubmission ───────────────────────────────────────────

    async getResubmitData(submissionId, token) {
        const response = await fetch(`${API_BASE}/submissions/${submissionId}/resubmit-data`, {
            headers: jsonHeaders(token),
        });
        if (!response.ok) throw await apiError(response);
        return response.json();
    },
};
