/**
 * Client-side validation for submission forms.
 * Mirrors backend validation.py logic for instant feedback.
 */

const LAT_MIN = 6.0, LAT_MAX = 38.0;
const LNG_MIN = 68.0, LNG_MAX = 98.0;
const DIRECTION_WARN_MIN = 30;
const DIRECTION_WARN_MAX = 330;

/**
 * Validate coordinates are non-zero and within India bounding box.
 */
export function validateCoordinates(lat, lng, label = 'Point') {
    const errors = [];
    const warnings = [];

    if (lat === 0 && lng === 0) {
        errors.push(`${label} coordinates are (0, 0) — likely missing data`);
    } else {
        if (lat < LAT_MIN || lat > LAT_MAX || lng < LNG_MIN || lng > LNG_MAX) {
            warnings.push(`${label} coordinates (${lat}, ${lng}) are outside India bounding box`);
        }
    }
    return { errors, warnings };
}

/**
 * Validate takeoff and approach directions.
 */
export function validateDirections(takeoff, approach) {
    const warnings = [];
    const diff = Math.abs(takeoff - approach) % 360;
    if (diff < DIRECTION_WARN_MIN || diff > DIRECTION_WARN_MAX) {
        warnings.push(
            `Takeoff (${takeoff}°) and approach (${approach}°) differ by ${diff}° — verify this is intentional`
        );
    }
    return { errors: [], warnings };
}

/**
 * Validate mission filename format.
 */
export function validateFilename(filename) {
    const errors = [];
    if (!filename || !filename.trim()) {
        errors.push('Mission filename is required');
    } else if (!filename.trim().endsWith('.waypoints')) {
        errors.push('Mission filename must end with .waypoints');
    }
    return { errors, warnings: [] };
}

/**
 * Validate a Google Drive link.
 */
export function validateDriveLink(link, label = 'File', required = true) {
    const errors = [];
    if (!link || !link.trim()) {
        if (required) errors.push(`${label} Drive link is required`);
        return { errors, warnings: [] };
    }
    const pattern = /(?:\/file\/d\/|id=|\/open\?id=)([a-zA-Z0-9_-]+)|^([a-zA-Z0-9_-]{20,})$/;
    if (!pattern.test(link)) {
        errors.push(`${label} link does not appear to be a valid Google Drive link`);
    }
    return { errors, warnings: [] };
}

/**
 * Validate .waypoints file content (client-side, from file upload).
 */
export function validateWaypointContent(content) {
    const errors = [];
    const warnings = [];

    if (!content || !content.trim()) {
        errors.push('Waypoint file is empty');
        return { errors, warnings };
    }

    const lines = content.trim().split('\n');
    const header = lines[0].trim();

    if (header !== 'QGC WPL 110') {
        errors.push(`Invalid header: expected 'QGC WPL 110', got '${header}'`);
        return { errors, warnings };
    }

    let hasVtolTakeoff = false;
    let hasLandingCmd = false;
    const zeroCoordLines = [];
    const navCommands = new Set([16,17,18,19,20,21,22,23,24,84,85,93,177,189]);

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split('\t');
        if (parts.length !== 12) {
            errors.push(`Line ${i + 1}: expected 12 columns, got ${parts.length}`);
            continue;
        }

        const index = parseInt(parts[0]);
        const cmd = parseInt(parts[3]);
        const lat = parseFloat(parts[8]);
        const lng = parseFloat(parts[9]);
        const alt = parseFloat(parts[10]);

        if (cmd === 84) hasVtolTakeoff = true;
        if (cmd === 85 || cmd === 218 || cmd === 21) hasLandingCmd = true;

        if (navCommands.has(cmd) && index > 0 && lat === 0 && lng === 0) {
            zeroCoordLines.push(i + 1);
        }

        if (navCommands.has(cmd) && !(lat === 0 && lng === 0)) {
            if (alt < 0 || alt > 1200) {
                warnings.push(`Line ${i + 1} (WP ${index}): altitude ${alt}m outside 0–1200m range`);
            }
        }
    }

    if (!hasVtolTakeoff) {
        errors.push('Missing VTOL_TAKEOFF (cmd 84) command');
    }
    if (!hasLandingCmd) {
        errors.push('Missing landing command (VTOL_LAND/DO_LAND_START/LAND)');
    }
    if (zeroCoordLines.length > 0) {
        errors.push(`Found (0,0) coordinates at line(s): ${zeroCoordLines.join(', ')}`);
    }

    return { errors, warnings };
}

/**
 * Run all validations on a complete payload.
 */
export function validateFullPayload(data) {
    const allErrors = [];
    const allWarnings = [];

    // Source coords
    const srcCoords = validateCoordinates(data.source_latitude, data.source_longitude, 'Source');
    allErrors.push(...srcCoords.errors);
    allWarnings.push(...srcCoords.warnings);

    // Dest coords
    const dstCoords = validateCoordinates(data.destination_latitude, data.destination_longitude, 'Destination');
    allErrors.push(...dstCoords.errors);
    allWarnings.push(...dstCoords.warnings);

    // Directions
    const dirs = validateDirections(data.takeoff_direction, data.approach_direction);
    allWarnings.push(...dirs.warnings);

    // Filename
    const fname = validateFilename(data.mission_filename);
    allErrors.push(...fname.errors);

    // Drive links
    const mLink = validateDriveLink(data.mission_drive_link, 'Mission file', true);
    allErrors.push(...mLink.errors);

    const eLink = validateDriveLink(data.elevation_image_drive_link, 'Elevation image', false);
    allErrors.push(...eLink.errors);

    const rLink = validateDriveLink(data.route_image_drive_link, 'Route image', false);
    allErrors.push(...rLink.errors);

    // Required text fields
    if (!data.network_name?.trim()) allErrors.push('Network is required');
    if (!data.source_location_name?.trim()) allErrors.push('Source location name is required');
    if (!data.source_takeoff_zone_name?.trim()) allErrors.push('Source takeoff zone name is required');
    if (!data.destination_location_name?.trim()) allErrors.push('Destination location name is required');
    if (!data.destination_landing_zone_name?.trim()) allErrors.push('Destination landing zone name is required');

    return { errors: allErrors, warnings: allWarnings, isValid: allErrors.length === 0 };
}
