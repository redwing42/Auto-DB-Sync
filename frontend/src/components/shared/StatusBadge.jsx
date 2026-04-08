import React from 'react';

const STATUS_MAP = {
    pending: 'status-pending',
    approved: 'status-approved',
    rejected: 'status-rejected',
    failed: 'status-failed',
    duplicate: 'status-duplicate',
};

export default function StatusBadge({ status, reason }) {
    return (
        <div className="status-badge-container group relative inline-block">
            <span className={`status-badge ${STATUS_MAP[status] || 'status-pending'}`}>
                {status}
            </span>
            
            {reason && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50">
                    <div className="bg-slate-900 text-white text-[10px] px-2 py-1.5 rounded shadow-xl whitespace-normal min-w-[120px] max-w-[200px] leading-tight text-center">
                        <div className="font-bold mb-1 border-b border-white/20 pb-0.5 uppercase tracking-wider">Reason</div>
                        {reason}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-slate-900" />
                    </div>
                </div>
            )}
        </div>
    );
}
