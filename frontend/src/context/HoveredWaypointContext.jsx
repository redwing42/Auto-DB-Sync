import React, { createContext, useContext, useMemo, useState } from 'react';

const HoveredWaypointContext = createContext(null);

export function HoveredWaypointProvider({ children }) {
    const [hoveredWaypointIndex, setHoveredWaypointIndex] = useState(null);
    const value = useMemo(() => ({ hoveredWaypointIndex, setHoveredWaypointIndex }), [hoveredWaypointIndex]);
    return (
        <HoveredWaypointContext.Provider value={value}>
            {children}
        </HoveredWaypointContext.Provider>
    );
}

export function useHoveredWaypoint() {
    const ctx = useContext(HoveredWaypointContext);
    if (!ctx) throw new Error('useHoveredWaypoint must be used within HoveredWaypointProvider');
    return ctx;
}

