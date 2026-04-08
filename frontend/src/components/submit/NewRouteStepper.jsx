import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    ArrowLeft, ArrowRight, Send, AlertTriangle, CheckCircle,
    Loader2, Upload, FileCheck, XCircle
} from 'lucide-react';
import { api } from '../../api/api';
import { auth } from '../../firebase';
import { useToast } from '../shared/Toast';
import StepperProgress from './StepperProgress';
import DraftSaveIndicator from './DraftSaveIndicator';
import { useDraftAutoSave } from '../../hooks/useDraftAutoSave';
import { validateDriveLink, validateDirections, validateFilename } from './submitValidation';

const STEPS = ['Network', 'Upload & Match', 'Drive Links', 'Review & Submit'];

const PROXIMITY_THRESHOLD = 0.000001;

const INITIAL_DATA = {
    network_name: '',
    source_location_name: '',
    source_takeoff_zone_name: '',
    source_latitude: '',
    source_longitude: '',
    destination_location_name: '',
    destination_landing_zone_name: '',
    destination_latitude: '',
    destination_longitude: '',
    takeoff_direction: '',
    approach_direction: '',
    mission_filename: '',
    mission_drive_link: '',
    elevation_image_drive_link: '',
    route_image_drive_link: '',
};

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

/** Compute compass bearing (0-359°) from point A → point B */
function bearing(lat1, lng1, lat2, lng2) {
    const toRad = d => d * Math.PI / 180;
    const dLng = toRad(lng2 - lng1);
    const phi1 = toRad(lat1), phi2 = toRad(lat2);
    const y = Math.sin(dLng) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
    return Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360);
}

export default function NewRouteStepper() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const addToast = useToast();
    const fileInputRef = useRef(null);
    const hydratedRef = useRef(false);

    const [step, setStep] = useState(1);
    const [data, setData] = useState(INITIAL_DATA);

    // Phase 4: Draft & resubmission params
    const draftIdParam = searchParams.get('draft');
    const resubmitIdParam = searchParams.get('resubmit');
    const { draftId, saving, lastSaved, saveDraft, saveNow, clearDraft, hydrate } =
        useDraftAutoSave('NEW_ROUTE', resubmitIdParam);

    // Step 1 — Networks
    const [networks, setNetworks] = useState([]);
    const [selectedNetwork, setSelectedNetwork] = useState(null);
    const [loadingNetworks, setLoadingNetworks] = useState(true);

    // Step 2 — File parsing
    const [waypointFile, setWaypointFile] = useState(null);
    const [parsing, setParsing] = useState(false);
    const [parseResult, setParseResult] = useState(null);
    const [parseError, setParseError] = useState(null);

    // Step 3 — DB matching
    const [landingZones, setLandingZones] = useState([]);
    const [loadingLZs, setLoadingLZs] = useState(false);
    const [sourceMatch, setSourceMatch] = useState(null); // null = loading, false = no match, object = matched
    const [destMatch, setDestMatch] = useState(null);
    const [sourceUnknown, setSourceUnknown] = useState(false);
    const [destUnknown, setDestUnknown] = useState(false);

    // Step 5 — submission
    const [submitting, setSubmitting] = useState(false);
    const [validating, setValidating] = useState(false);
    const [serverValidation, setServerValidation] = useState(null);
    const [duplicateCheck, setDuplicateCheck] = useState(null);

    const [stepErrors, setStepErrors] = useState([]);

    // Phase 4: Hydrate from draft or resubmission
    useEffect(() => {
        if (hydratedRef.current) return;
        (async () => {
            try {
                const token = await auth.currentUser?.getIdToken();
                if (!token) return;
                if (draftIdParam) {
                    const draft = await api.getDraft(draftIdParam, token);
                    const payload = JSON.parse(draft.payload_json);
                    setData(prev => ({ ...prev, ...payload }));
                    hydrate(draftIdParam);
                    if (payload.network_name) {
                        // Will be matched once networks load
                    }
                    addToast('Draft restored');
                } else if (resubmitIdParam) {
                    const resub = await api.getResubmitData(resubmitIdParam, token);
                    setData(prev => ({ ...prev, ...resub.payload }));
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

    // Phase 4: Auto-save draft on data changes (debounced)
    useEffect(() => {
        if (!hydratedRef.current) return; // Don't save during hydration
        saveDraft(data);
    }, [data]);

    const update = (field, value) => setData(prev => ({ ...prev, [field]: value }));

    const numVal = (field) => {
        const v = data[field];
        return v === '' || v === null || v === undefined ? 0 : Number(v);
    };

    // ── Step 2: parse file & match ──────────────────────────────────────
    const handleFileSelect = async (file) => {
        setWaypointFile(file);
        setParseResult(null);
        setParseError(null);
        setSourceMatch(null);
        setDestMatch(null);
        if (!file) return;

        setParsing(true);
        try {
            const result = await api.parseWaypoints(file);
            setParseResult(result);
            update('mission_filename', file.name);
            
            // Trigger matching immediately if we have a network
            if (selectedNetwork) {
                await performMatching(result, selectedNetwork.id);
            }
        } catch (e) {
            setParseError(e.message);
        } finally {
            setParsing(false);
        }
    };

    const performMatching = async (parseRes, networkId) => {
        setLoadingLZs(true);
        try {
            const lzs = await api.getNetworkLandingZones(networkId);
            setLandingZones(lzs);
            const { takeoff, vtolLand, navWaypoints } = getKeyWaypoints(parseRes);

            if (takeoff) {
                const srcLat = takeoff.latitude;
                const srcLng = takeoff.longitude;
                const match = matchLandingZone(lzs, srcLat, srcLng, 'proximity');
                setSourceMatch(match || false);
                setSourceUnknown(!match);
                update('source_latitude', srcLat);
                update('source_longitude', srcLng);
                if (match) {
                    update('source_location_name', match.location_name);
                    update('source_takeoff_zone_name', match.name);
                }

                // Auto-calculate takeoff direction
                const firstNav = navWaypoints[0];
                if (firstNav) {
                    update('takeoff_direction', bearing(srcLat, srcLng, firstNav.latitude, firstNav.longitude));
                } else if (vtolLand) {
                    update('takeoff_direction', bearing(srcLat, srcLng, vtolLand.latitude, vtolLand.longitude));
                }
            }

            if (vtolLand) {
                const dstLat = vtolLand.latitude;
                const dstLng = vtolLand.longitude;
                const match = matchLandingZone(lzs, dstLat, dstLng, 'exact');
                setDestMatch(match || false);
                setDestUnknown(!match);
                update('destination_latitude', dstLat);
                update('destination_longitude', dstLng);
                if (match) {
                    update('destination_location_name', match.location_name);
                    update('destination_landing_zone_name', match.name);
                }

                // Auto-calculate approach direction
                const lastNav = navWaypoints[navWaypoints.length - 1];
                if (lastNav) {
                    update('approach_direction', bearing(lastNav.latitude, lastNav.longitude, dstLat, dstLng));
                } else if (takeoff) {
                    update('approach_direction', bearing(takeoff.latitude, takeoff.longitude, dstLat, dstLng));
                }
            }
        } catch (e) {
            addToast(`Matching failed: ${e.message}`);
        } finally {
            setLoadingLZs(false);
        }
    };

    // Extract key waypoints from parsed file
    const getKeyWaypoints = (pRes = parseResult) => {
        if (!pRes) return { takeoff: null, vtolLand: null, navWaypoints: [] };
        const wps = pRes.waypoints;

        // Source: index 0 (home position) has the real takeoff ground coords.
        // The TAKEOFF command (22/84) stores 0,0 by design in ArduPilot.
        const takeoff = wps.find(w => w.index === 0 && w.latitude !== 0 && w.longitude !== 0)
            || wps.find(w => [22, 84].includes(w.command) && w.latitude !== 0 && w.longitude !== 0);

        // Destination: first VTOL_LAND (85) or LAND (21) with real coords
        const vtolLand = wps.find(w => [85, 21].includes(w.command) && w.latitude !== 0 && w.longitude !== 0)
            || [...wps].reverse().find(w => w.latitude !== 0 && w.longitude !== 0 && w.index !== 0);

        // Nav waypoints (excludes home and action commands) for direction calculation
        const navWaypoints = wps.filter(w => w.index !== 0 && w.latitude !== 0 && w.longitude !== 0
            && ![22, 84, 21, 85].includes(w.command));

        return { takeoff, vtolLand, navWaypoints };
    };

    // Re-trigger matching if network changes while file is already uploaded
    useEffect(() => {
        if (waypointFile && parseResult && selectedNetwork) {
            performMatching(parseResult, selectedNetwork.id);
        }
    }, [selectedNetwork]);

    // ── Step 4: server validation ──────────────────────────────────────
    useEffect(() => {
        if (step === 4) {
            (async () => {
                setValidating(true);
                setServerValidation(null);
                setDuplicateCheck(null);
                try {
                    const payload = buildPayload();
                    const [valResult, dupResult] = await Promise.all([
                        api.validateSubmission(payload),
                        api.checkDuplicate(payload),
                    ]);
                    setServerValidation(valResult);
                    setDuplicateCheck(dupResult);
                } catch (e) {
                    addToast(`Validation failed: ${e.message}`);
                } finally {
                    setValidating(false);
                }
            })();
        }
    }, [step]);

    const buildPayload = () => ({
        network_name: data.network_name,
        source_location_name: data.source_location_name,
        source_takeoff_zone_name: data.source_takeoff_zone_name,
        source_latitude: numVal('source_latitude'),
        source_longitude: numVal('source_longitude'),
        destination_location_name: data.destination_location_name,
        destination_landing_zone_name: data.destination_landing_zone_name,
        destination_latitude: numVal('destination_latitude'),
        destination_longitude: numVal('destination_longitude'),
        takeoff_direction: numVal('takeoff_direction'),
        approach_direction: numVal('approach_direction'),
        mission_filename: data.mission_filename,
        mission_drive_link: data.mission_drive_link,
        elevation_image_drive_link: data.elevation_image_drive_link || '',
        route_image_drive_link: data.route_image_drive_link || '',
    });

    const validateCurrentStep = () => {
        const errors = [];
        switch (step) {
            case 1:
                if (!data.network_name) errors.push('Please select a network');
                break;
            case 2: {
                if (!parseResult) errors.push('Please upload and parse a .waypoints file');
                if (parseError) errors.push(`Parse failed: ${parseError}`);
                if (parseResult) {
                    if (!data.source_location_name.trim()) errors.push('Source location name is required (not matched — please enter manually)');
                    if (!data.source_takeoff_zone_name.trim()) errors.push('Source takeoff zone name is required');
                    if (!data.destination_location_name.trim()) errors.push('Destination location name is required (not matched — please enter manually)');
                    if (!data.destination_landing_zone_name.trim()) errors.push('Destination landing zone name is required');
                    if (data.takeoff_direction === '' || data.takeoff_direction === null) errors.push('Takeoff direction is required');
                    if (data.approach_direction === '' || data.approach_direction === null) errors.push('Approach direction is required');
                    const fn = validateFilename(data.mission_filename);
                    errors.push(...fn.errors);
                }
                break;
            }
            case 3: {
                const m = validateDriveLink(data.mission_drive_link, 'Mission file', true);
                errors.push(...m.errors);
                const e = validateDriveLink(data.elevation_image_drive_link, 'Elevation image', false);
                errors.push(...e.errors);
                const r = validateDriveLink(data.route_image_drive_link, 'Route image', false);
                errors.push(...r.errors);
                break;
            }
        }
        setStepErrors(errors);
        return errors.length === 0;
    };

    const handleNext = () => {
        if (validateCurrentStep()) {
            setStepErrors([]);
            // Phase 4: Immediate save on step transition
            saveNow(data);
            setStep(s => s + 1);
        }
    };

    const handleBack = () => {
        setStepErrors([]);
        saveNow(data);
        setStep(s => s - 1);
    };

    const handleSubmit = async () => {
        setSubmitting(true);
        try {
            const result = await api.createSubmission(buildPayload());
            // Phase 4: Clear draft on successful submission
            await clearDraft();
            addToast(`Submission created: #${result.submission_id.slice(0, 8)}`);
            navigate('/');
        } catch (e) {
            addToast(`Submit failed: ${e.message}`);
        } finally {
            setSubmitting(false);
        }
    };

    const canSubmit = serverValidation?.is_valid && !duplicateCheck?.is_exact_duplicate && !submitting;

    const { takeoff, vtolLand } = getKeyWaypoints();

    // ── Match status badge ─────────────────────────────────────────────
    const Matchbadge = ({ matched, label }) => matched
        ? <span className="match-badge match-badge--ok"><CheckCircle size={12} /> Matched: {matched.location_name} / {matched.name}</span>
        : <span className="match-badge match-badge--warn"><XCircle size={12} /> {label} — Unrecognized. Enter manually below.</span>;

    return (
        <div className="stepper-container" id="new-route-stepper">
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/submit')} style={{ marginBottom: 16 }}>
                <ArrowLeft size={14} /> Back
            </button>

            <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h1>New Route Submission</h1>
                <DraftSaveIndicator saving={saving} lastSaved={lastSaved} />
            </div>
            <StepperProgress steps={STEPS} currentStep={step} />

            {stepErrors.length > 0 && (
                <div className="validation-box validation-error" id="step-errors">
                    <AlertTriangle size={16} />
                    <div>{stepErrors.map((e, i) => <div key={i}>{e}</div>)}</div>
                </div>
            )}

            <div className="stepper-content">

                {/* ── STEP 1: Network ── */}
                {step === 1 && (
                    <div className="form-step" id="step-network">
                        <h3 className="form-step-title">Select Network</h3>
                        {loadingNetworks ? (
                            <div className="loading-state">Loading networks...</div>
                        ) : (
                            <div className="form-group">
                                <label className="form-label">Network</label>
                                <select
                                    className="form-select"
                                    id="select-network"
                                    value={data.network_name}
                                    onChange={e => {
                                        const net = networks.find(n => n.name === e.target.value);
                                        setSelectedNetwork(net || null);
                                        update('network_name', e.target.value);
                                    }}
                                >
                                    <option value="">— Select a network —</option>
                                    {networks.map(n => (
                                        <option key={n.id} value={n.name}>{n.name} ({n.route_count} routes)</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>
                )}

                {/* ── STEP 2: Upload & Match ── */}
                {step === 2 && (
                    <div className="form-step" id="step-upload-match">
                        <h3 className="form-step-title">Upload &amp; Match</h3>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
                            Upload the <code>.waypoints</code> mission file. Source and destination coordinates will be extracted and matched against the database.
                        </p>
                        
                        <div
                            className={`file-drop-zone ${waypointFile ? 'file-drop-zone--active' : ''}`}
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); }}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".waypoints"
                                style={{ display: 'none' }}
                                onChange={e => handleFileSelect(e.target.files[0])}
                            />
                            {parsing ? (
                                <div className="flex flex-col items-center gap-8">
                                    <Loader2 size={32} className="spin" style={{ color: 'var(--primary)' }} />
                                    <span>Parsing &amp; Matching...</span>
                                </div>
                            ) : parseResult ? (
                                <div className="flex flex-col items-center gap-8">
                                    <FileCheck size={32} style={{ color: 'var(--success)' }} />
                                    <strong>{data.mission_filename}</strong>
                                    <span style={{ color: 'var(--text-secondary)' }}>{parseResult.total_waypoints} waypoints parsed</span>
                                    <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setParseResult(null); setWaypointFile(null); }}>
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
                                {loadingLZs ? (
                                    <div className="loading-state"><Loader2 size={16} className="spin" /> Matching coordinates...</div>
                                ) : (
                                    <>
                                        <div className="sections-row" style={{ marginTop: 20 }}>
                                            {/* Source */}
                                            <div className="match-section">
                                                <div className="match-section-title">
                                                    Source (Takeoff)
                                                </div>
                                                <Matchbadge matched={sourceMatch} label="No lz match" />
                                                <div className="form-grid" style={{ marginTop: 12 }}>
                                                    <div className="form-group">
                                                        <label className="form-label">Location {sourceUnknown && <span className="unrecognized-tag">!</span>}</label>
                                                        <input className="form-input" id="input-source-location"
                                                            value={data.source_location_name}
                                                            onChange={e => update('source_location_name', e.target.value)}
                                                            placeholder="Location" />
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Takeoff Zone</label>
                                                        <input className="form-input" id="input-source-tz"
                                                            value={data.source_takeoff_zone_name}
                                                            onChange={e => update('source_takeoff_zone_name', e.target.value)}
                                                            placeholder="Zone name" />
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Lat</label>
                                                        <input className="form-input text-sm" type="number" step="any" readOnly
                                                            value={data.source_latitude} style={{ background: '#f8fafc' }} />
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Lng</label>
                                                        <input className="form-input text-sm" type="number" step="any" readOnly
                                                            value={data.source_longitude} style={{ background: '#f8fafc' }} />
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Destination */}
                                            <div className="match-section">
                                                <div className="match-section-title">
                                                    Destination (VTOL Land)
                                                </div>
                                                <Matchbadge matched={destMatch} label="No exact match" />
                                                <div className="form-grid" style={{ marginTop: 12 }}>
                                                    <div className="form-group">
                                                        <label className="form-label">Location {destUnknown && <span className="unrecognized-tag">!</span>}</label>
                                                        <input className="form-input" id="input-dest-location"
                                                            value={data.destination_location_name}
                                                            onChange={e => update('destination_location_name', e.target.value)}
                                                            placeholder="Location" />
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Landing Zone</label>
                                                        <input className="form-input" id="input-dest-lz"
                                                            value={data.destination_landing_zone_name}
                                                            onChange={e => update('destination_landing_zone_name', e.target.value)}
                                                            placeholder="LZ name" />
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Lat</label>
                                                        <input className="form-input text-sm" type="number" step="any" readOnly
                                                            value={data.destination_latitude} style={{ background: '#f8fafc' }} />
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Lng</label>
                                                        <input className="form-input text-sm" type="number" step="any" readOnly
                                                            value={data.destination_longitude} style={{ background: '#f8fafc' }} />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Route Details */}
                                        <div className="match-section" style={{ marginTop: 16 }}>
                                            <div className="match-section-title">Route Parameters</div>
                                            <div className="form-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                                                <div className="form-group">
                                                    <label className="form-label">Takeoff Dir (°)</label>
                                                    <input className="form-input" type="number" min="0" max="360" id="input-takeoff-dir"
                                                        value={data.takeoff_direction}
                                                        onChange={e => update('takeoff_direction', e.target.value)} />
                                                </div>
                                                <div className="form-group">
                                                    <label className="form-label">Approach Dir (°)</label>
                                                    <input className="form-input" type="number" min="0" max="360" id="input-approach-dir"
                                                        value={data.approach_direction}
                                                        onChange={e => update('approach_direction', e.target.value)} />
                                                </div>
                                                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                                                    <label className="form-label">Filename</label>
                                                    <input className="form-input" readOnly value={data.mission_filename} style={{ background: '#f8fafc' }} />
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ── STEP 3: Drive Links ── */}
                {step === 3 && (
                    <div className="form-step" id="step-drive-links">
                        <h3 className="form-step-title">Google Drive Links</h3>
                        <div className="form-group">
                            <label className="form-label">Waypoint File (required)</label>
                            <input className="form-input" id="input-mission-link" placeholder="https://drive.google.com/file/d/..."
                                value={data.mission_drive_link} onChange={e => update('mission_drive_link', e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Elevation Image (optional)</label>
                            <input className="form-input" id="input-elevation-link" placeholder="https://drive.google.com/file/d/..."
                                value={data.elevation_image_drive_link} onChange={e => update('elevation_image_drive_link', e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Route Image (optional)</label>
                            <input className="form-input" id="input-route-link" placeholder="https://drive.google.com/file/d/..."
                                value={data.route_image_drive_link} onChange={e => update('route_image_drive_link', e.target.value)} />
                        </div>
                    </div>
                )}

                {/* ── STEP 4: Review & Submit ── */}
                {step === 4 && (
                    <div className="form-step" id="step-summary">
                        <h3 className="form-step-title">Review &amp; Confirm</h3>

                        {validating && (
                            <div className="validation-box validation-info">
                                <Loader2 size={16} className="spin" /> Validating with server...
                            </div>
                        )}
                        {serverValidation && !serverValidation.is_valid && (
                            <div className="validation-box validation-error">
                                <AlertTriangle size={16} />
                                <div>
                                    <strong>Validation failed:</strong>
                                    {serverValidation.errors.map((e, i) => <div key={i}>• {e}</div>)}
                                    {serverValidation.drive_link_errors.map((e, i) => <div key={`d${i}`}>• {e}</div>)}
                                </div>
                            </div>
                        )}
                        {duplicateCheck?.is_exact_duplicate && (
                            <div className="validation-box validation-error">
                                <AlertTriangle size={16} />
                                <div><strong>Exact duplicate detected:</strong> {duplicateCheck.message}</div>
                            </div>
                        )}
                        {duplicateCheck?.is_near_duplicate && !duplicateCheck.is_exact_duplicate && (
                            <div className="validation-box validation-warning">
                                <AlertTriangle size={16} />
                                <div><strong>Near-duplicate warning:</strong> {duplicateCheck.message}</div>
                            </div>
                        )}
                        {serverValidation?.is_valid && !duplicateCheck?.is_exact_duplicate && (
                            <div className="validation-box validation-success">
                                <CheckCircle size={16} /> All checks passed
                            </div>
                        )}

                        <div className="summary-grid">
                            <div className="summary-section">
                                <div className="summary-section-title">Network</div>
                                <div className="summary-row"><span>Network</span><strong>{data.network_name}</strong></div>
                            </div>
                            <div className="summary-section">
                                <div className="summary-section-title">Source</div>
                                <div className="summary-row"><span>Location</span><strong>{data.source_location_name}</strong></div>
                                <div className="summary-row"><span>Takeoff Zone</span><strong>{data.source_takeoff_zone_name}</strong></div>
                                <div className="summary-row"><span>Coordinates</span><strong>{data.source_latitude}, {data.source_longitude}</strong></div>
                            </div>
                            <div className="summary-section">
                                <div className="summary-section-title">Destination</div>
                                <div className="summary-row"><span>Location</span><strong>{data.destination_location_name}</strong></div>
                                <div className="summary-row"><span>Landing Zone</span><strong>{data.destination_landing_zone_name}</strong></div>
                                <div className="summary-row"><span>Coordinates</span><strong>{data.destination_latitude}, {data.destination_longitude}</strong></div>
                            </div>
                            <div className="summary-section">
                                <div className="summary-section-title">Route</div>
                                <div className="summary-row"><span>Takeoff Dir</span><strong>{data.takeoff_direction}°</strong></div>
                                <div className="summary-row"><span>Approach Dir</span><strong>{data.approach_direction}°</strong></div>
                                <div className="summary-row"><span>Mission File</span><strong>{data.mission_filename}</strong></div>
                            </div>
                            <div className="summary-section summary-section--full">
                                <div className="summary-section-title">Drive Links</div>
                                <div className="summary-row"><span>Waypoints</span><strong className="summary-link">{data.mission_drive_link}</strong></div>
                                {data.elevation_image_drive_link && (
                                    <div className="summary-row"><span>Elevation</span><strong className="summary-link">{data.elevation_image_drive_link}</strong></div>
                                )}
                                {data.route_image_drive_link && (
                                    <div className="summary-row"><span>Route Image</span><strong className="summary-link">{data.route_image_drive_link}</strong></div>
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
                    <button className="btn btn-primary" id="btn-next" onClick={handleNext} disabled={step === 2 && (parsing || loadingLZs)}>
                        {step === 2 && (parsing || loadingLZs) ? <><Loader2 size={14} className="spin" /> Processing...</> : <>Next <ArrowRight size={14} /></>}
                    </button>
                )}
                {step === 4 && (
                    <button className="btn btn-primary" id="btn-submit" onClick={handleSubmit} disabled={!canSubmit}>
                        {submitting ? <><Loader2 size={14} className="spin" /> Submitting...</> : <><Send size={14} /> Submit Route</>}
                    </button>
                )}
            </div>
        </div>
    );
}
