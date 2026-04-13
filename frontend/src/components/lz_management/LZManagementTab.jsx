import React, { useState, useEffect } from 'react';
import { api } from '../../api/api';
import { useToast } from '../shared/Toast';
import { MapPin, Plus, Pencil, Trash2, Check, X, Loader2, Search } from 'lucide-react';
import RequiresRole from '../shared/RequiresRole';
import { ROLES } from '../../constants';

export default function LZManagementTab() {
    const addToast = useToast();
    const [networks, setNetworks] = useState([]);
    const [selectedNetId, setSelectedNetId] = useState('');
    const [lzs, setLzs] = useState([]);
    const [locations, setLocations] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    
    // Add/Edit states
    const [showAddForm, setShowAddForm] = useState(false);
    const [editingLzId, setEditingLzId] = useState(null);
    const [formData, setFormData] = useState({ name: '', latitude: '', longitude: '', location_id: '' });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api.getNetworks().then(setNetworks).catch(e => addToast(`Error: ${e.message}`));
        api.getLocations().then(setLocations).catch(e => addToast(`Error: ${e.message}`));
    }, []);

    const fetchLzs = async (netId) => {
        if (!netId) { setLzs([]); return; }
        setLoading(true);
        try {
            const data = await api.getNetworkLandingZones(netId);
            setLzs(data);
        } catch (e) {
            addToast(`Error: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLzs(selectedNetId);
    }, [selectedNetId]);

    const handleEdit = (lz) => {
        setEditingLzId(lz.id);
        setFormData({ name: lz.name, latitude: lz.latitude, longitude: lz.longitude, location_id: lz.location_id });
    };

    const handleCancel = () => {
        setEditingLzId(null);
        setShowAddForm(false);
        setFormData({ name: '', latitude: '', longitude: '', location_id: '' });
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const payload = {
                name: formData.name,
                latitude: parseFloat(formData.latitude),
                longitude: parseFloat(formData.longitude)
            };
            
            if (editingLzId) {
                await api.updateLandingZone(editingLzId, payload);
                addToast('Landing zone updated successfully');
            } else {
                await api.createLandingZone(selectedNetId, { ...payload, location_id: parseInt(formData.location_id) });
                addToast('Landing zone created successfully');
            }
            fetchLzs(selectedNetId);
            handleCancel();
        } catch (err) {
            addToast(`Save failed: ${err.message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (lzId) => {
        if (!window.confirm('Are you sure you want to delete this landing zone? This action cannot be undone.')) return;
        
        setSaving(true);
        try {
            await api.deleteLandingZone(lzId);
            addToast('Landing zone deleted successfully');
            fetchLzs(selectedNetId);
        } catch (err) {
            addToast(`Delete failed: ${err.message}`);
        } finally {
            setSaving(false);
        }
    };

    const filteredLzs = lzs.filter(lz => 
        lz.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        lz.location_name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="lz-mgmt-container">
            <div className="page-header">
                <h1>Landing Zone Management</h1>
                <div className="flex gap-8">
                    <select className="form-select" value={selectedNetId} onChange={e => setSelectedNetId(e.target.value)} style={{ width: 220 }}>
                        <option value="">— Select Network —</option>
                        {networks.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                    </select>
                    <button className="btn btn-primary btn-sm" disabled={!selectedNetId} onClick={() => setShowAddForm(true)}>
                        <Plus size={14} /> Add New LZ
                    </button>
                </div>
            </div>

            {selectedNetId && (
                <div className="lz-mgmt-search">
                    <Search size={16} className="search-icon" />
                    <input 
                        type="text" 
                        placeholder="Search LZs by name or location..." 
                        value={searchTerm} 
                        onChange={e => setSearchTerm(e.target.value)}
                        className="form-input"
                    />
                </div>
            )}

            {showAddForm && (
                <div className="lz-form-card">
                    <h3>Add New Landing Zone</h3>
                    <form onSubmit={handleSave} className="form-grid">
                        <div className="form-group">
                            <label className="form-label">Location Site</label>
                            <select 
                                className="form-select" 
                                required 
                                value={formData.location_id}
                                onChange={e => setFormData({...formData, location_id: e.target.value})}
                            >
                                <option value="">— Select Site —</option>
                                {locations.map(loc => <option key={loc.id} value={loc.id}>{loc.name} ({loc.code})</option>)}
                            </select>
                        </div>
                        <div className="form-group">
                            <label className="form-label">LZ Name</label>
                            <input className="form-input" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. Pad 1" />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Latitude</label>
                            <input type="number" step="any" className="form-input" required value={formData.latitude} onChange={e => setFormData({...formData, latitude: e.target.value})} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Longitude</label>
                            <input type="number" step="any" className="form-input" required value={formData.longitude} onChange={e => setFormData({...formData, longitude: e.target.value})} />
                        </div>
                        <div className="form-actions flex gap-8" style={{ gridColumn: 'span 2', marginTop: 8 }}>
                            <button type="submit" className="btn btn-primary" disabled={saving}>
                                {saving ? <Loader2 size={14} className="spin" /> : 'Create LZ'}
                            </button>
                            <button type="button" className="btn btn-ghost" onClick={handleCancel}>Cancel</button>
                        </div>
                    </form>
                </div>
            )}

            {loading ? (
                <div className="loading-state">Loading landing zones...</div>
            ) : !selectedNetId ? (
                <div className="empty-state">Please select a network to view and manage its landing zones.</div>
            ) : filteredLzs.length === 0 ? (
                <div className="empty-state">No landing zones found matching your search.</div>
            ) : (
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Location Site</th>
                            <th>LZ Name</th>
                            <th>Latitude</th>
                            <th>Longitude</th>
                            <th style={{ width: 100 }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredLzs.map(lz => (
                            <tr key={lz.id}>
                                {editingLzId === lz.id ? (
                                    <>
                                        <td>{lz.location_name}</td>
                                        <td><input className="form-input sm" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} /></td>
                                        <td><input type="number" step="any" className="form-input sm" value={formData.latitude} onChange={e => setFormData({...formData, latitude: e.target.value})} /></td>
                                        <td><input type="number" step="any" className="form-input sm" value={formData.longitude} onChange={e => setFormData({...formData, longitude: e.target.value})} /></td>
                                        <td>
                                            <div className="flex gap-8">
                                                <button className="btn-icon btn-success" onClick={handleSave} disabled={saving}>
                                                    {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                                                </button>
                                                <button className="btn-icon btn-ghost" onClick={handleCancel}><X size={14} /></button>
                                            </div>
                                        </td>
                                    </>
                                ) : (
                                    <>
                                        <td><strong>{lz.location_name}</strong></td>
                                        <td className="table-meta">{lz.name}</td>
                                        <td className="table-meta"><code>{lz.latitude.toFixed(6)}</code></td>
                                        <td className="table-meta"><code>{lz.longitude.toFixed(6)}</code></td>
                                        <td>
                                            <div className="flex gap-8">
                                                <button className="btn btn-ghost btn-sm" onClick={() => handleEdit(lz)} style={{ fontSize: '11px', padding: '2px 8px' }}>
                                                    Edit
                                                </button>
                                                <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(lz.id)} style={{ fontSize: '11px', padding: '2px 8px', color: 'var(--danger)' }}>
                                                    Delete
                                                </button>
                                            </div>
                                        </td>
                                    </>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
