import React, { useState } from 'react';
import { api } from '../../api/api';
import RequiresRole from '../shared/RequiresRole';

export default function FilesTab({ sub, onReload }) {
    const [downloading, setDownloading] = useState(false);
    const [error, setError] = useState(null);

    const handleDownload = async () => {
        setDownloading(true);
        setError(null);
        try {
            await api.downloadFiles(sub.id);
            await onReload();
        } catch (err) {
            setError(err.message);
        } finally {
            setDownloading(false);
        }
    };

    const files = sub.downloaded_files || {};
    const p = sub.payload;

    return (
        <div>
            {/* Download controls */}
            <div className="card mb-24">
                <div className="flex items-center gap-12">
                    <span className={`dl-badge dl-${sub.download_status ?? 'not_started'}`}>
                        {(sub.download_status ?? 'not started').replace(/_/g, ' ')}
                    </span>

                    {sub.status === 'pending' && (
                        <RequiresRole role="operator">
                            <button
                                className="btn btn-primary"
                                onClick={handleDownload}
                                disabled={downloading}
                            >
                                {downloading ? 'Downloading...' : '📥 Download All Files'}
                            </button>
                        </RequiresRole>
                    )}
                </div>

                {error && <div className="banner banner-error" style={{ marginTop: 12 }}>⚠ {error}</div>}

                {sub.download_status === 'failed' && (
                    <div className="dl-error-hint">
                        <strong>Possible Fix:</strong> Ensure the Google Drive links are shared as{' '}
                        <em>"Anyone with the link"</em> and not restricted.
                    </div>
                )}
            </div>

            {/* File status table */}
            <div className="card mb-24">
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>File Status</h3>
                <table className="preview-table">
                    <thead>
                        <tr>
                            <th>File</th>
                            <th>Name</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Waypoint File</td>
                            <td>{p.mission_filename}</td>
                            <td>
                                <span className={`dl-badge ${files.mission_file ? 'dl-completed' : 'dl-not_started'}`}>
                                    {files.mission_file ? '✓ Downloaded' : 'Not downloaded'}
                                </span>
                            </td>
                        </tr>
                        <tr>
                            <td>Elevation Image</td>
                            <td>{p.mission_filename.replace('.waypoints', ' elevation graph.png')}</td>
                            <td>
                                <span className={`dl-badge ${files.elevation_image ? 'dl-completed' : 'dl-not_started'}`}>
                                    {files.elevation_image ? '✓ Downloaded' : 'Not downloaded'}
                                </span>
                            </td>
                        </tr>
                        <tr>
                            <td>Route Image</td>
                            <td>{p.mission_filename.replace('.waypoints', ' flight route.png')}</td>
                            <td>
                                <span className={`dl-badge ${files.route_image ? 'dl-completed' : 'dl-not_started'}`}>
                                    {files.route_image ? '✓ Downloaded' : 'Not downloaded'}
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* Drive Links */}
            <div className="card mb-24">
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Drive Links</h3>
                <div className="detail-grid">
                    <div className="detail-field">
                        <label>Mission File</label>
                        <span><a href={p.mission_drive_link} target="_blank" rel="noreferrer">Open in Drive ↗</a></span>
                    </div>
                    {p.elevation_image_drive_link && (
                        <div className="detail-field">
                            <label>Elevation Image</label>
                            <span><a href={p.elevation_image_drive_link} target="_blank" rel="noreferrer">Open in Drive ↗</a></span>
                        </div>
                    )}
                    {p.route_image_drive_link && (
                        <div className="detail-field">
                            <label>Route Image</label>
                            <span><a href={p.route_image_drive_link} target="_blank" rel="noreferrer">Open in Drive ↗</a></span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
