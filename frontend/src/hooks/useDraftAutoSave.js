import { useRef, useCallback, useEffect, useState } from 'react';
import { auth } from '../firebase';
import { api } from '../api/api';

const DEBOUNCE_MS = 3000; // 3 seconds

/**
 * Auto-save draft hook for submission forms.
 * Debounces saves to avoid spamming the API.
 *
 * @param {string} submissionType - 'NEW_ROUTE' or 'UPDATE'
 * @param {string|null} parentSubmissionId - If resubmitting
 * @returns {{ draftId, saving, lastSaved, saveDraft, clearDraft }}
 */
export function useDraftAutoSave(submissionType = 'NEW_ROUTE', parentSubmissionId = null) {
    const [draftId, setDraftId] = useState(null);
    const [saving, setSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState(null);
    const timerRef = useRef(null);
    const latestPayloadRef = useRef(null);

    const doSave = useCallback(async (payloadObj, label) => {
        const user = auth.currentUser;
        if (!user) return;

        setSaving(true);
        try {
            const token = await user.getIdToken();
            const result = await api.saveDraft({
                payload_json: JSON.stringify(payloadObj),
                submission_type: submissionType,
                draft_id: draftId,
                parent_submission_id: parentSubmissionId,
                label: label || generateLabel(payloadObj),
            }, token);
            setDraftId(result.draft_id);
            setLastSaved(new Date());
        } catch (err) {
            console.warn('Draft auto-save failed:', err);
        } finally {
            setSaving(false);
        }
    }, [draftId, submissionType, parentSubmissionId]);

    /**
     * Queue a debounced save. Call on every significant form change.
     */
    const saveDraft = useCallback((payloadObj, label) => {
        latestPayloadRef.current = { payload: payloadObj, label };
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            if (latestPayloadRef.current) {
                doSave(latestPayloadRef.current.payload, latestPayloadRef.current.label);
            }
        }, DEBOUNCE_MS);
    }, [doSave]);

    /**
     * Force an immediate save (e.g. on step change).
     */
    const saveNow = useCallback(async (payloadObj, label) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        await doSave(payloadObj, label);
    }, [doSave]);

    /**
     * Delete the current draft.
     */
    const clearDraft = useCallback(async () => {
        if (!draftId) return;
        const user = auth.currentUser;
        if (!user) return;
        try {
            const token = await user.getIdToken();
            await api.deleteDraft(draftId, token);
            setDraftId(null);
            setLastSaved(null);
        } catch (err) {
            console.warn('Draft delete failed:', err);
        }
    }, [draftId]);

    /**
     * Hydrate from an existing draft.
     */
    const hydrate = useCallback((existingDraftId) => {
        setDraftId(existingDraftId);
    }, []);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    return { draftId, saving, lastSaved, saveDraft, saveNow, clearDraft, hydrate };
}

function generateLabel(payload) {
    const parts = [];
    if (payload?.network_name) parts.push(payload.network_name);
    if (payload?.source_location_name && payload?.destination_location_name) {
        parts.push(`${payload.source_location_name} → ${payload.destination_location_name}`);
    }
    return parts.length > 0 ? parts.join(' · ') : 'Untitled Draft';
}
