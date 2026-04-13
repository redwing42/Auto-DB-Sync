/**
 * MAVLink command ID to human-readable name mapping.
 */
export const MAVLINK_COMMANDS = {
    16: 'WAYPOINT',
    17: 'LOITER_UNLIM',
    18: 'LOITER_TURNS',
    19: 'LOITER_TIME',
    20: 'RETURN_TO_LAUNCH',
    21: 'LAND',
    22: 'TAKEOFF',
    84: 'VTOL_TAKEOFF',
    85: 'VTOL_LAND',
    115: 'LOITER_TO_ALT',
    201: 'TAKEOFF',
    177: 'DO_JUMP',
    178: 'DO_CHANGE_SPEED',
    189: 'DO_LAND_START',
    190: 'DO_GO_AROUND',
    193: 'DO_SET_CAM_TRIGG_DIST',
    195: 'DO_SET_ROI',
    200: 'DO_CONTROL_VIDEO',
    203: 'DO_AUX_FUNCTION',
    206: 'DO_SET_MISSION_CURRENT',
    3000: 'SET_HOME',
};

const COORD_FRAMES = {
    0: 'Global (MSL)',
    3: 'Global Relative (AGL)',
    6: 'GLOBAL_INT',
    10: 'AGL',
};

const ACTION_COMMANDS = new Set([177, 178, 189, 203]);

export function getCommandName(code) {
    return MAVLINK_COMMANDS[code] || `CMD_${code}`;
}

/**
 * Parse a QGC WPL 110 waypoints file (text content).
 * Returns array of waypoint objects matching the backend WaypointData model.
 */
export function parseWaypointsFile(text) {
    const lines = text.trim().split('\n');
    if (!lines[0]?.startsWith('QGC WPL')) {
        throw new Error('Not a valid QGC waypoints file');
    }

    const waypoints = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].trim().split(/\t/);
        if (parts.length < 12) continue;

        const command = parseInt(parts[3], 10);
        const coord_frame = parseInt(parts[2], 10);

        waypoints.push({
            index: parseInt(parts[0], 10),
            current_wp: parseInt(parts[1], 10),
            coord_frame,
            command,
            command_name: getCommandName(command),
            coord_frame_name: COORD_FRAMES[coord_frame] || `FRAME_${coord_frame}`,
            is_action_command: ACTION_COMMANDS.has(command),
            param1: parseFloat(parts[4]),
            param2: parseFloat(parts[5]),
            param3: parseFloat(parts[6]),
            param4: parseFloat(parts[7]),
            latitude: parseFloat(parts[8]),
            longitude: parseFloat(parts[9]),
            altitude: parseFloat(parts[10]),
            autocontinue: parseInt(parts[11], 10),
            angle: parts.length >= 13 ? parseFloat(parts[12]) : undefined,
        });
    }

    return waypoints;
}
