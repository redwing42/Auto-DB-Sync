import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    ArrowLeft, ArrowRight, Send, AlertTriangle, CheckCircle,
    Loader2, Upload, FileCheck, XCircle, Info
} from 'lucide-react';
import { api } from '../../api/api';
import { auth } from '../../firebase';
import { useToast } from '../shared/Toast';
import StepperProgress from './StepperProgress';
import DiffDisplay, { DiffSummary } from './DiffDisplay';
import DraftSaveIndicator from './DraftSaveIndicator';
import { useDraftAutoSave } from '../../hooks/useDraftAutoSave';

const STEPS = ['Select Route', 'Upload & Match', 'Drive Links', 'Review & Submit'];

const FIELD_LABELS = {
    network_name: 'Network',
    source_location_name: 'Source Location',
    source_takeoff_zone_name: 'Takeoff Zone',
    source_latitude: 'Source Lat',
    source_longitude: 'Source Lng',
    destination_location_name: 'Dest Location',
    destination_landing_zone_name: 'Landing Zone',
    destination_latitude: 'Dest Lat',
    destination_longitude: 'Dest Lng',
    takeoff_direction: 'Takeoff Dir',
    approach_direction: 'Approach Dir',
    mission_filename: 'Mission File',
    mission_drive_link: 'Mission Link',
    elevation_image_drive_link: 'Elevation Link',
    route_image_drive_link: 'Route Image Link',
};

const PROXIMITY_THRESHOLD = 0.000001;

function matchLandingZone(lzList, lat, lng, mode = 'proximity') {
    if (!lzList || lzList.length === 0) return null;
    for (const lz of lzList) {
        if (mode === 'exact') {
            if (lz.latitude === lat && lz.longitude === lng) return lz;
        } else {
            if (Math.abs(lz.latitude - lat) <= PROXIMITY_THRESHOLD &&
                Math.abs(lz.longitude - lng) <= PROXIMITY_THRESHOLD) return lz;
        }
    }
    return null;
}

function bearing(lat1, lng1, lat2, lng2) {
    const toRad = d => d * Math.PI / 180;
    const dLng = toRad(lng2 - lng1);
    const phi1 = toRad(lat1), phi2 = toRad(lat2);
    const y = Math.sin(dLng) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
    return Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360);
}

export default function UpdateRouteStepper() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const addToast = useToast();
    const fileInputRef = useRef(null);
    const hydratedRef = useRef(false);

    const [step, setStep] = useState(1);

    // Phase 4: Draft support
    const resubmitIdParam = searchParams.get('resubmit');
    const { draftId, saving, lastSaved, saveDraft, saveNow, clearDraft, hydrate } =
        useDraftAutoSave('UPDATE', resubmitIdParam);

    // Step 1 & 2
    const [networks, setNetworks] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [selectedNetworkId, setSelectedNetworkId] = useState('');
    const [selectedNetwork, setSelectedNetwork] = useState(null);
    const [selectedRoute, setSelectedRoute] = useState(null);
    const [loadingNetworks, setLoadingNetworks] = useState(true);
    const [loadingRoutes, setLoadingRoutes] = useState(false);

    // Step 3 — file upload
    const [waypointFile, setWaypointFile] = useState(null);
    const [parsing, setParsing] = useState(false);
    const [parseResult, setParseResult] = useState(null);
    const [parseError, setParseError] = useState(null);

    // Original route data (from DB) + edited data (from new file + overrides)
    const [originalData, setOriginalData] = useState({});
    const [editedData, setEditedData] = useState({});

    // Step 5 — submission
    const [submitting, setSubmitting] = useState(false);
    const [validating, setValidating] = useState(false);
    const [serverValidation, setServerValidation] = useState(null);
    const [duplicateCheck, setDuplicateCheck] = useState(null);
    const [stepErrors, setStepErrors] = useState([]);

    const draftIdParam = searchParams.get('draft');

    // Hydrate from draft or resubmission
    useEffect(() => {
        if (hydratedRef.current) return;
        (async () => {
            try {
                const token = await auth.currentUser?.getIdToken();
                if (!token) return;

                if (draftIdParam) {
                    const draft = await api.getDraft(draftIdParam, token);
                    const payload = JSON.parse(draft.payload_json);
                    if (payload.editedData) setEditedData(payload.editedData);
                    if (payload.originalData) setOriginalData(payload.originalData);
                    if (payload.selectedRouteId) {
                        // We'll fetch route details later if needed, but for now just set state
                    }
                    hydrate(draftIdParam);
                    addToast('Draft restored');
                } else if (resubmitIdParam) {
                    const resub = await api.getResubmitData(resubmitIdParam, token);
                    const payload = resub.payload;
                    
                    // Set edited data from the rejected submission
                    setEditedData(prev => ({ ...prev, ...payload }));
                    
                    // We need to fetch the current route state to set as originalData
                    if (payload.update_for_route_id) {
                        try {
                            const route = await api.getRoute(payload.update_for_route_id);
                            setSelectedRoute(route);
                            // Set original data from the DB route
                            const original = {
                                network_name: '', // Will be filled once networks load or from route
                                source_location_name: route.start_location_name,
                                source_takeoff_zone_name: route.start_lz_name,
                                source_latitude: route.start_latitude,
                                source_longitude: route.start_longitude,
                                destination_location_name: route.end_location_name,
                                destination_landing_zone_name: route.end_lz_name,
                                destination_latitude: route.end_latitude,
                                destination_longitude: route.end_longitude,
                                takeoff_direction: route.takeoff_direction,
                                approach_direction: route.approach_direction,
                                mission_filename: route.mission_filename || '',
                                mission_drive_link: '',
                                elevation_image_drive_link: '',
                                route_image_drive_link: '',
                            };
                            setOriginalData(original);
                            setSelectedNetworkId(route.network_id);
                        } catch (e) {
                            console.warn('Failed to fetch original route for resubmit:', e);
                        }
                    }
                    addToast(`Resubmitting — previously rejected: ${resub.rejection_reason || 'No reason'}`);
                }
            } catch (err) {
                console.warn('Hydration failed:', err);
            } finally {
                hydratedRef.current = true;
            }
        })();
    }, [draftIdParam, resubmitIdParam]);

    useEffect(() => {
        api.getNetworks()
            .then(setNetworks)
            .catch(e => addToast(`Failed to load networks: ${e.message}`))
            .finally(() => setLoadingNetworks(false));
    }, []);

    // Phase 4: Auto-save on editedData changes
    useEffect(() => {
        if (!hydratedRef.current && draftIdParam) return;
        if (Object.keys(editedData).length === 0) return;
        saveDraft({ editedData, originalData, selectedRouteId: selectedRoute?.id });
    }, [editedData]);

    const loadRoutes = async (networkId) => {
        setLoadingRoutes(true);
        try { setRoutes(await api.getNetworkRoutes(networkId)); }
        catch (e) { addToast(`Failed to load routes: ${e.message}`); }
        finally { setLoadingRoutes(false); }
    };

    const selectNetwork = (netId) => {
        setSelectedNetworkId(netId);
        setSelectedNetwork(networks.find(n => String(n.id) === String(netId)) || null);
        if (netId) loadRoutes(netId);
    };

    const selectRoute = (route) => {
        setSelectedRoute(route);
        const networkName = networks.find(n => n.id === route.network_id)?.name || '';
        const data = {
            network_name: networkName,
            source_location_name: route.start_location_name,
            source_takeoff_zone_name: route.start_lz_name,
            source_latitude: route.start_latitude,
            source_longitude: route.start_longitude,
            destination_location_name: route.end_location_name,
            destination_landing_zone_name: route.end_lz_name,
            destination_latitude: route.end_latitude,
            destination_longitude: route.end_longitude,
            takeoff_direction: route.takeoff_direction,
            approach_direction: route.approach_direction,
            mission_filename: route.mission_filename || '',
            mission_drive_link: '',
            elevation_image_drive_link: '',
            route_image_drive_link: '',
        };
        setOriginalData({ ...data });
        setEditedData({ ...data });
    };

    const update = (field, value) => setEditedData(prev => ({ ...prev, [field]: value }));

    // ── Step 2: parse new waypoint file & match ───────────────────────
    const handleFileSelect = async (file) => {
        setWaypointFile(file);
        setParseResult(null);
        setParseError(null);
        if (!file) return;

        setParsing(true);
        try {
            const result = await api.parseWaypoints(file);
            setParseResult(result);
            const wps = result.waypoints;

            const takeoffWp = wps.find(w => w.index === 0 && w.latitude !== 0 && w.longitude !== 0)
                || wps.find(w => [22, 84].includes(w.command) && w.latitude !== 0 && w.longitude !== 0);

            const vtolLandWp = wps.find(w => [85, 21].includes(w.command) && w.latitude !== 0 && w.longitude !== 0)
                || [...wps].reverse().find(w => w.latitude !== 0 && w.longitude !== 0 && w.index !== 0);

            const navWps = wps.filter(w => w.index !== 0 && w.latitude !== 0 && w.longitude !== 0
                && ![22, 84, 21, 85].includes(w.command));

            const updates = { mission_filename: file.name };

            if (takeoffWp) {
                updates.source_latitude = takeoffWp.latitude;
                updates.source_longitude = takeoffWp.longitude;
                const firstNav = navWps[0];
                const bearingTarget = firstNav || vtolLandWp;
                if (bearingTarget) {
                    updates.takeoff_direction = bearing(takeoffWp.latitude, takeoffWp.longitude, bearingTarget.latitude, bearingTarget.longitude);
                }
            }

            if (vtolLandWp) {
                updates.destination_latitude = vtolLandWp.latitude;
                updates.destination_longitude = vtolLandWp.longitude;
                const lastNav = navWps[navWps.length - 1];
                const approachFrom = lastNav || takeoffWp;
                if (approachFrom) {
                    updates.approach_direction = bearing(approachFrom.latitude, approachFrom.longitude, vtolLandWp.latitude, vtolLandWp.longitude);
                }
            }

            // Match names from DB
            if (selectedNetwork) {
                try {
                    const lzs = await api.getNetworkLandingZones(selectedNetwork.id);
                    if (takeoffWp) {
                        const m = matchLandingZone(lzs, takeoffWp.latitude, takeoffWp.longitude, 'proximity');
                        if (m) {
                            updates.source_location_name = m.location_name;
                            updates.source_takeoff_zone_name = m.name;
                        }
                    }
                    if (vtolLandWp) {
                        const m = matchLandingZone(lzs, vtolLandWp.latitude, vtolLandWp.longitude, 'exact');
                        if (m) {
                            updates.destination_location_name = m.location_name;
                            updates.destination_landing_zone_name = m.name;
                        }
                    }
                } catch (_) { /* non-critical */ }
            }

            setEditedData(prev => ({ ...prev, ...updates }));
        } catch (e) {
            setParseError(e.message);
        } finally {
            setParsing(false);
        }
    };

    const getChangedFields = () => Object.keys(originalData).filter(
        k => String(originalData[k]) !== String(editedData[k])
    );

    // Phase 4: Build changed_fields dictionary for the payload
    const buildChangedFieldsDict = () => {
        const dict = {};
        for (const key of Object.keys(originalData)) {
            if (String(originalData[key]) !== String(editedData[key])) {
                dict[key] = { old: originalData[key], new: editedData[key] };
            }
        }
        return dict;
    };

    const buildPayload = () => ({
        ...editedData,
        source_latitude: Number(editedData.source_latitude),
        source_longitude: Number(editedData.source_longitude),
        destination_latitude: Number(editedData.destination_latitude),
        destination_longitude: Number(editedData.destination_longitude),
        takeoff_direction: Number(editedData.takeoff_direction),
        approach_direction: Number(editedData.approach_direction),
        is_update: true,
        update_for_route_id: selectedRoute?.id,
        // Phase 4: Include changed_fields dict
        changed_fields: buildChangedFieldsDict(),
    });

    const validateCurrentStep = () => {
        const errors = [];
        switch (step) {
            case 1: if (!selectedRoute) errors.push('Please select a route to update'); break;
            case 2:
                if (!parseResult && !parseError) errors.push('Please upload a new .waypoints file');
                if (parseError) errors.push(`Parse failed: ${parseError}`);
                if (parseResult) {
                    if (!editedData.source_location_name?.trim()) errors.push('Source location name missing');
                    if (!editedData.source_takeoff_zone_name?.trim()) errors.push('Source takeoff zone name missing');
                    if (!editedData.destination_location_name?.trim()) errors.push('Destination location name missing');
                    if (!editedData.destination_landing_zone_name?.trim()) errors.push('Destination landing zone name missing');
                }
                break;
            case 3:
                if (!editedData.mission_drive_link?.trim()) errors.push('Mission drive link is required');
                break;
        }
        setStepErrors(errors);
        return errors.length === 0;
    };

    const handleNext = () => {
        if (validateCurrentStep()) {
            setStepErrors([]);
            saveNow({ editedData, originalData, selectedRouteId: selectedRoute?.id });
            setStep(s => s + 1);
        }
    };
    const handleBack = () => {
        setStepErrors([]);
        saveNow({ editedData, originalData, selectedRouteId: selectedRoute?.id });
        setStep(s => s - 1);
    };

    useEffect(() => {
        if (step === 4) {
            (async () => {
                setValidating(true);
                try {
                    const payload = buildPayload();
                    const [val, dup] = await Promise.all([
                        api.validateSubmission(payload),
                        api.checkDuplicate(payload),
                    ]);
                    setServerValidation(val);
                    setDuplicateCheck(dup);
                } catch (e) {
                    addToast(`Validation failed: ${e.message}`);
                } finally {
                    setValidating(false);
                }
            })();
        }
    }, [step]);

    const handleSubmit = async () => {
        setSubmitting(true);
        try {
            const result = await api.createSubmission(buildPayload());
            await clearDraft();
            addToast(`Update submitted: #${result.submission_id.slice(0, 8)}`);
            navigate('/');
        } catch (e) {
            addToast(`Submit failed: ${e.message}`);
        } finally {
            setSubmitting(false);
        }
    };

    const canSubmit = serverValidation?.is_valid && !submitting;
    const changedFields = getChangedFields();

    // Derive key coords from parse for preview display
    const parsedTakeoff = parseResult?.waypoints?.find(w => w.index === 0 && w.latitude !== 0 && w.longitude !== 0);
    const parsedVtolLand = parseResult?.waypoints?.find(w => [85, 21].includes(w.command) && w.latitude !== 0 && w.longitude !== 0)
        || (parseResult?.waypoints ? [...parseResult.waypoints].reverse().find(w => w.latitude !== 0 && w.longitude !== 0 && w.index !== 0) : null);

    return (
        <div className="stepper-container" id="update-route-stepper">
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/submit')} style={{ marginBottom: 16 }}>
                <ArrowLeft size={14} /> Back
            </button>

            <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h1>Update Existing Route</h1>
                <DraftSaveIndicator saving={saving} lastSaved={lastSaved} />
            </div>
            <StepperProgress steps={STEPS} currentStep={step} />

            {stepErrors.length > 0 && (
                <div className="validation-box validation-error">
                    <AlertTriangle size={16} />
                    <div>{stepErrors.map((e, i) => <div key={i}>{e}</div>)}</div>
                </div>
            )}

            <div className="stepper-content">

                {/* ── STEP 1: Select Route ── */}
                {step === 1 && (
                    <div className="form-step" id="update-step-selection">
                        <h3 className="form-step-title">Select Route to Update</h3>
                        
                        <div className="form-group">
                            <label className="form-label">Network</label>
                            {loadingNetworks ? (
                                <div className="loading-state">Loading networks...</div>
                            ) : (
                                <select className="form-select" id="update-select-network"
                                    value={selectedNetworkId}
                                    onChange={e => selectNetwork(e.target.value)}>
                                    <option value="">— Select a network —</option>
                                    {networks.map(n => (
                                        <option key={n.id} value={n.id}>{n.name} ({n.route_count} routes)</option>
                                    ))}
                                </select>
                            )}
                        </div>

                        {selectedNetworkId && (
                            <div style={{ marginTop: 24 }}>
                                <label className="form-label">Route</label>
                                {loadingRoutes ? (
                                    <div className="loading-state">Loading routes...</div>
                                ) : routes.length === 0 ? (
                                    <div className="loading-state">No routes found for this network.</div>
                                ) : (
                                    <div className="route-select-table-wrap">
                                        <table className="data-table" id="route-select-table">
                                            <thead>
                                                <tr>
                                                    <th>ID</th><th>Route</th><th>Mission File</th>
                                                    <th>Takeoff</th><th>Approach</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {routes.map(r => (
                                                    <tr key={r.id}
                                                        className={selectedRoute?.id === r.id ? 'selected-row' : ''}
                                                        onClick={() => selectRoute(r)}>
                                                        <td className="table-id">#{r.id}</td>
                                                        <td>
                                                            <span className="table-route">{r.start_location_name}</span>
                                                            <span className="table-route-arrow"> → </span>
                                                            <span className="table-route">{r.end_location_name}</span>
                                                        </td>
                                                        <td className="table-meta">{r.mission_filename}</td>
                                                        <td className="table-meta">{r.takeoff_direction}°</td>
                                                        <td className="table-meta">{r.approach_direction}°</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ── STEP 2: Upload & Match ── */}
                {step === 2 && (
                    <div className="form-step" id="update-step-upload-match">
                        <h3 className="form-step-title">Upload &amp; Match</h3>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
                            Upload the updated <code>.waypoints</code> file to compare against the current route.
                        </p>
                        
                        <div
                            className={`file-drop-zone ${waypointFile ? 'file-drop-zone--active' : ''}`}
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); }}
                        >
                            <input ref={fileInputRef} type="file" accept=".waypoints"
                                style={{ display: 'none' }}
                                onChange={e => handleFileSelect(e.target.files[0])} />
                            {parsing ? (
                                <div className="flex flex-col items-center gap-8">
                                    <Loader2 size={32} className="spin" style={{ color: 'var(--primary)' }} />
                                    <span>Parsing &amp; Matching...</span>
                                </div>
                            ) : parseResult ? (
                                <div className="flex flex-col items-center gap-8">
                                    <FileCheck size={32} style={{ color: 'var(--success)' }} />
                                    <strong>{editedData.mission_filename}</strong>
                                    <span style={{ color: 'var(--text-secondary)' }}>{parseResult.total_waypoints} waypoints parsed</span>
                                    <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setParseResult(null); setWaypointFile(null); setEditedData({ ...originalData }); }}>
                                        Change file
                                    </button>
                                </div>
                            ) : parseError ? (
                                <div className="flex flex-col items-center gap-8" style={{ color: 'var(--danger)' }}>
                                    <XCircle size={32} />
                                    <span>Parse failed: {parseError}</span>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Click to try again</span>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-8">
                                    <Upload size={32} style={{ color: 'var(--text-secondary)' }} />
                                    <span><strong>Click to upload</strong> or drag &amp; drop</span>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>.waypoints files only</span>
                                </div>
                            )}
                        </div>

                        {parseResult && (
                            <div style={{ marginTop: 24 }}>
                                <div className="diff-summary" style={{ marginBottom: 24 }}>
                                    <div className="diff-summary-title">
                                        Comparison: Current vs. New File
                                    </div>
                                    {Object.keys(FIELD_LABELS).map(key => {
                                        if (['mission_drive_link', 'elevation_image_drive_link', 'route_image_drive_link'].includes(key)) return null;
                                        return (
                                            <DiffDisplay
                                                key={key}
                                                label={FIELD_LABELS[key]}
                                                field={key}
                                                oldValue={originalData[key]}
                                                newValue={editedData[key]}
                                            />
                                        );
                                    })}
                                </div>

                                <div className="match-section-title">Manual Overrides &amp; Names</div>
                                <div className="form-grid" style={{ marginTop: 12 }}>
                                    <div className="form-group">
                                        <label className="form-label">Source Location</label>
                                        <input className="form-input" value={editedData.source_location_name || ''} onChange={e => update('source_location_name', e.target.value)} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Takeoff Zone</label>
                                        <input className="form-input" value={editedData.source_takeoff_zone_name || ''} onChange={e => update('source_takeoff_zone_name', e.target.value)} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Dest Location</label>
                                        <input className="form-input" value={editedData.destination_location_name || ''} onChange={e => update('destination_location_name', e.target.value)} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Landing Zone</label>
                                        <input className="form-input" value={editedData.destination_landing_zone_name || ''} onChange={e => update('destination_landing_zone_name', e.target.value)} />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ── STEP 3: Drive Links ── */}
                {step === 3 && (
                    <div className="form-step" id="update-step-drive">
                        <h3 className="form-step-title">Google Drive Links</h3>
                        <div className="form-group">
                            <label className="form-label">Waypoint File (required)</label>
                            <input className="form-input" placeholder="https://drive.google.com/file/d/..."
                                value={editedData.mission_drive_link || ''}
                                onChange={e => update('mission_drive_link', e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Elevation Image (optional)</label>
                            <input className="form-input" placeholder="https://drive.google.com/file/d/..."
                                value={editedData.elevation_image_drive_link || ''}
                                onChange={e => update('elevation_image_drive_link', e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Route Image (optional)</label>
                            <input className="form-input" placeholder="https://drive.google.com/file/d/..."
                                value={editedData.route_image_drive_link || ''}
                                onChange={e => update('route_image_drive_link', e.target.value)} />
                        </div>
                    </div>
                )}

                {/* ── STEP 4: Review & Submit ── */}
                {step === 4 && (
                    <div className="form-step" id="update-step-submit">
                        <h3 className="form-step-title">Confirm &amp; Submit Update</h3>
                        {validating && (
                            <div className="validation-box validation-info">
                                <Loader2 size={16} className="spin" /> Validating...
                            </div>
                        )}
                        {serverValidation && !serverValidation.is_valid && (
                            <div className="validation-box validation-error">
                                <AlertTriangle size={16} />
                                <div>
                                    {serverValidation.errors.map((e, i) => <div key={i}>• {e}</div>)}
                                    {serverValidation.drive_link_errors.map((e, i) => <div key={`d${i}`}>• {e}</div>)}
                                </div>
                            </div>
                        )}
                        {duplicateCheck?.is_exact_duplicate && (
                            <div className="validation-box validation-info">
                                <Info size={16} /><div>Note: {duplicateCheck.message}</div>
                            </div>
                        )}
                        {serverValidation?.is_valid && (
                            <div className="validation-box validation-success">
                                <CheckCircle size={16} /> Ready to submit update
                            </div>
                        )}

                        <div className="summary-grid" style={{ marginTop: 16 }}>
                            <div className="summary-section">
                                <div className="summary-section-title">Network</div>
                                <div className="summary-row"><span>Network</span><strong>{editedData.network_name}</strong></div>
                            </div>
                            <div className="summary-section summary-section--full">
                                <div className="summary-section-title">Changes Overview</div>
                                <DiffSummary changedFields={buildChangedFieldsDict()} />
                            </div>
                            <div className="summary-section summary-section--full">
                                <div className="summary-section-title">Drive Links</div>
                                <div className="summary-row"><span>Waypoints</span><strong className="summary-link">{editedData.mission_drive_link}</strong></div>
                                {editedData.elevation_image_drive_link && (
                                    <div className="summary-row"><span>Elevation</span><strong className="summary-link">{editedData.elevation_image_drive_link}</strong></div>
                                )}
                                {editedData.route_image_drive_link && (
                                    <div className="summary-row"><span>Route Image</span><strong className="summary-link">{editedData.route_image_drive_link}</strong></div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Navigation */}
            <div className="stepper-nav">
                {step > 1 && (
                    <button className="btn btn-ghost" onClick={handleBack} disabled={submitting}>
                        <ArrowLeft size={14} /> Back
                    </button>
                )}
                <div style={{ flex: 1 }} />
                {step < 4 && (
                    <button className="btn btn-primary" onClick={handleNext} disabled={step === 2 && parsing}>
                        {step === 2 && parsing ? <><Loader2 size={14} className="spin" /> Parsing...</> : <>Next <ArrowRight size={14} /></>}
                    </button>
                )}
                {step === 4 && (
                    <button className="btn btn-primary" id="btn-submit-update" onClick={handleSubmit} disabled={!canSubmit}>
                        {submitting ? <><Loader2 size={14} className="spin" /> Submitting...</> : <><Send size={14} /> Submit Update</>}
                    </button>
                )}
            </div>
        </div>
    );
}
