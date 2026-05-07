import React, { useState, useEffect, useCallback } from 'react';
import { settingsApi } from '../../api/settings';
import { warehouseApi } from '../../api/warehouse';
import styles from './WarehousePage.module.css';

const ZONE_TYPES = [
  { v: 'standard',   l: 'Standard'     },
  { v: 'pick',       l: 'Pick Zone'    },
  { v: 'bulk',       l: 'Bulk Storage' },
  { v: 'receive',    l: 'Receiving'    },
  { v: 'dispatch',   l: 'Dispatch'     },
  { v: 'quarantine', l: 'Quarantine'   },
];
const BIN_TYPES = [
  { v: 'standard',   l: 'Standard'     },
  { v: 'oversize',   l: 'Oversize'     },
  { v: 'hazmat',     l: 'Hazmat'       },
  { v: 'cold',       l: 'Cold Storage' },
  { v: 'quarantine', l: 'Quarantine'   },
];
const ZONE_COLOR = {
  standard:   'var(--text-sub)',
  pick:       'var(--accent)',
  bulk:       '#a78bfa',
  receive:    'var(--green)',
  dispatch:   'var(--orange)',
  quarantine: 'var(--red)',
};

const EMPTY_ZONE = { code: '', name: '', zone_type: 'standard', pick_sequence: 0 };
const EMPTY_BIN  = { bin_code: '', barcode: '', bin_type: 'standard', pick_sequence: 0, notes: '', max_weight_kg: '', max_volume_m3: '', max_units: '' };

// Main area views
const VIEW = {
  SELECT_WH:   'select_wh',
  SELECT_ZONE: 'select_zone',
  ZONE_FORM:   'zone_form',
  BINS:        'bins',
};

export default function WarehousePage() {
  const [warehouses,        setWarehouses]        = useState([]);
  const [zones,             setZones]             = useState([]);
  const [bins,              setBins]              = useState([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState(null);
  const [selectedZone,      setSelectedZone]      = useState(null);
  const [loadingWh,         setLoadingWh]         = useState(true);
  const [loadingZones,      setLoadingZones]      = useState(false);
  const [loadingBins,       setLoadingBins]       = useState(false);
  const [view,              setView]              = useState(VIEW.SELECT_WH);

  // Zone form
  const [zoneForm,   setZoneForm]   = useState(EMPTY_ZONE);
  const [zoneIsNew,  setZoneIsNew]  = useState(true);
  const [zoneError,  setZoneError]  = useState('');
  const [savingZone, setSavingZone] = useState(false);

  // Bin form
  const [binForm,    setBinForm]    = useState(EMPTY_BIN);
  const [editingBin, setEditingBin] = useState(null); // null | 'new' | id
  const [binError,   setBinError]   = useState('');
  const [savingBin,  setSavingBin]  = useState(false);

  useEffect(() => {
    settingsApi.listWarehouses()
      .then(({ data }) => setWarehouses(data.data))
      .finally(() => setLoadingWh(false));
  }, []);

  const loadZones = useCallback(async (wh) => {
    setLoadingZones(true);
    setZones([]);
    setSelectedZone(null);
    setBins([]);
    setEditingBin(null);
    setView(VIEW.SELECT_ZONE);
    try {
      const { data } = await warehouseApi.listZones(wh.id);
      setZones(data.data);
    } finally {
      setLoadingZones(false);
    }
  }, []);

  const loadBins = useCallback(async (zone) => {
    setLoadingBins(true);
    setBins([]);
    setEditingBin(null);
    setView(VIEW.BINS);
    try {
      const { data } = await warehouseApi.listBins({ zone_id: zone.id });
      setBins(data.data);
    } finally {
      setLoadingBins(false);
    }
  }, []);

  function selectWarehouse(w) {
    setSelectedWarehouse(w);
    loadZones(w);
  }

  function selectZone(z) {
    setSelectedZone(z);
    loadBins(z);
  }

  function openZoneForm(zone = null) {
    if (zone) {
      setZoneForm({ code: zone.code, name: zone.name, zone_type: zone.zone_type, pick_sequence: zone.pick_sequence });
      setZoneIsNew(false);
    } else {
      setZoneForm(EMPTY_ZONE);
      setZoneIsNew(true);
    }
    setZoneError('');
    setView(VIEW.ZONE_FORM);
  }

  // ── Zone actions ─────────────────────────────────────────────

  function setZ(f, v) { setZoneForm(prev => ({ ...prev, [f]: v })); }

  async function handleZoneSave(e) {
    e.preventDefault();
    setSavingZone(true);
    setZoneError('');
    try {
      if (zoneIsNew) {
        const { data } = await warehouseApi.createZone({ ...zoneForm, warehouse_id: selectedWarehouse.id });
        // Load zones then auto-select the new one
        const zd = await warehouseApi.listZones(selectedWarehouse.id);
        setZones(zd.data.data);
        const newZone = zd.data.data.find(z => z.id === data.data.id);
        if (newZone) {
          setSelectedZone(newZone);
          await loadBins(newZone);
        } else {
          setView(VIEW.SELECT_ZONE);
        }
      } else {
        await warehouseApi.updateZone(selectedZone.id, {
          name: zoneForm.name, zone_type: zoneForm.zone_type, pick_sequence: zoneForm.pick_sequence,
        });
        const zd = await warehouseApi.listZones(selectedWarehouse.id);
        setZones(zd.data.data);
        const updated = zd.data.data.find(z => z.id === selectedZone.id);
        if (updated) setSelectedZone(updated);
        await loadBins(updated || selectedZone);
      }
    } catch (err) {
      setZoneError(err.response?.data?.error || 'Save failed.');
      setSavingZone(false);
    } finally {
      setSavingZone(false);
    }
  }

  async function handleZoneDeactivate(zone) {
    if (!window.confirm(`Deactivate zone "${zone.name}"? All bins must be deactivated first.`)) return;
    try {
      await warehouseApi.deleteZone(zone.id);
      setSelectedZone(null);
      setBins([]);
      setView(VIEW.SELECT_ZONE);
      const zd = await warehouseApi.listZones(selectedWarehouse.id);
      setZones(zd.data.data);
    } catch (err) {
      window.alert(err.response?.data?.error || 'Failed to deactivate zone.');
    }
  }

  // ── Bin actions ──────────────────────────────────────────────

  function setB(f, v) { setBinForm(prev => ({ ...prev, [f]: v })); }

  async function handleBinSave(e) {
    e.preventDefault();
    setSavingBin(true);
    setBinError('');
    try {
      const payload = {
        ...binForm,
        warehouse_id:  selectedWarehouse.id,
        zone_id:       selectedZone.id,
        max_weight_kg: binForm.max_weight_kg !== '' ? parseFloat(binForm.max_weight_kg) : null,
        max_volume_m3: binForm.max_volume_m3 !== '' ? parseFloat(binForm.max_volume_m3) : null,
        max_units:     binForm.max_units     !== '' ? parseInt(binForm.max_units)        : null,
        pick_sequence: parseInt(binForm.pick_sequence) || 0,
      };
      if (editingBin === 'new') {
        await warehouseApi.createBin(payload);
      } else {
        await warehouseApi.updateBin(editingBin, payload);
      }
      setEditingBin(null);
      const [bd, zd] = await Promise.all([
        warehouseApi.listBins({ zone_id: selectedZone.id }),
        warehouseApi.listZones(selectedWarehouse.id),
      ]);
      setBins(bd.data.data);
      setZones(zd.data.data);
    } catch (err) {
      setBinError(err.response?.data?.error || 'Save failed.');
    } finally {
      setSavingBin(false);
    }
  }

  async function handleBinDeactivate(bin) {
    if (!window.confirm(`Deactivate bin "${bin.bin_code}"?`)) return;
    try {
      await warehouseApi.deleteBin(bin.id);
      const [bd, zd] = await Promise.all([
        warehouseApi.listBins({ zone_id: selectedZone.id }),
        warehouseApi.listZones(selectedWarehouse.id),
      ]);
      setBins(bd.data.data);
      setZones(zd.data.data);
    } catch (err) {
      window.alert(err.response?.data?.error || 'Failed to deactivate bin.');
    }
  }

  if (loadingWh) return (
    <div className={styles.page}>
      <div className={styles.loading}><div className="spinner-dark" /> Loading...</div>
    </div>
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Warehouse Locations</h1>
          <p className={styles.sub}>Manage zones and bins across your warehouse network.</p>
        </div>
      </div>

      <div className={styles.layout}>

        {/* ── Sidebar ───────────────────────────────────────── */}
        <div className={styles.sidebar}>
          <div className={styles.sidebarHead}>Warehouses</div>

          {warehouses.length === 0 && (
            <div className={styles.emptyTree}>
              No warehouses configured. Add one in <a href="/settings">Settings → Warehouses</a>.
            </div>
          )}

          {warehouses.map(w => (
            <div key={w.id} className={styles.whGroup}>
              <button
                className={`${styles.whRow} ${selectedWarehouse?.id === w.id ? styles.whActive : ''}`}
                onClick={() => selectedWarehouse?.id !== w.id && selectWarehouse(w)}
              >
                <span className={styles.whCode}>{w.code}</span>
                <span className={styles.whName}>{w.name}</span>
                {selectedWarehouse?.id === w.id ? <ChevronDownIcon /> : <ChevronRightIcon />}
              </button>

              {selectedWarehouse?.id === w.id && (
                <div className={styles.zoneList}>
                  {loadingZones && (
                    <div className={styles.zoneLoading}>
                      <div className="spinner-dark" style={{ width: 14, height: 14 }} />
                    </div>
                  )}

                  {!loadingZones && zones.map(z => (
                    <button
                      key={z.id}
                      className={`${styles.zoneRow} ${selectedZone?.id === z.id && view === VIEW.BINS ? styles.zoneActive : ''} ${!z.is_active ? styles.zoneInactive : ''}`}
                      onClick={() => selectZone(z)}
                    >
                      <span className={styles.zoneDot} style={{ background: ZONE_COLOR[z.zone_type] }} />
                      <span className={styles.zoneName}>{z.name}</span>
                      <span className={styles.zoneBinCount}>{z.bin_count}</span>
                    </button>
                  ))}

                  {!loadingZones && (
                    <button className={styles.addZoneBtn} onClick={() => openZoneForm(null)}>
                      <PlusIcon /> Add Zone
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── Main content area ──────────────────────────────── */}
        <div className={styles.main}>

          {/* No warehouse selected */}
          {view === VIEW.SELECT_WH && (
            <div className={styles.emptyMain}>
              <WarehouseEmptyIcon />
              <p>Select a warehouse to manage its zones and bins.</p>
            </div>
          )}

          {/* Warehouse selected, pick a zone */}
          {view === VIEW.SELECT_ZONE && (
            <div className={styles.emptyMain}>
              <ZoneEmptyIcon />
              <p>Select a zone from the sidebar to view and manage its bins.</p>
              {zones.length === 0 && !loadingZones && (
                <p style={{ fontSize: 13, color: 'var(--text-sub)' }}>
                  This warehouse has no zones yet.
                </p>
              )}
              <button className="btn btn-primary" onClick={() => openZoneForm(null)}>
                <PlusIcon /> Add first zone
              </button>
            </div>
          )}

          {/* Zone create / edit form */}
          {view === VIEW.ZONE_FORM && (
            <div className={styles.formPanel}>
              <div className={styles.formPanelHead}>
                <h2 className={styles.formPanelTitle}>
                  {zoneIsNew ? 'New Zone' : `Edit Zone — ${selectedZone?.name}`}
                </h2>
                <p className={styles.formPanelSub}>
                  {zoneIsNew
                    ? `Adding a zone to ${selectedWarehouse?.name}`
                    : 'Update zone details'}
                </p>
              </div>

              {zoneError && <div className={styles.formError}>{zoneError}</div>}

              <form className={styles.zoneFormGrid} onSubmit={handleZoneSave}>
                <div className="form-group">
                  <label className="form-label">Code *</label>
                  <input
                    className="form-input" value={zoneForm.code} maxLength={20}
                    onChange={e => setZ('code', e.target.value.toUpperCase())}
                    placeholder="RCV" disabled={!zoneIsNew} required
                  />
                  <span className={styles.fieldHint}>Short identifier, e.g. PICK-A, RCV, BULK</span>
                </div>
                <div className="form-group">
                  <label className="form-label">Name *</label>
                  <input
                    className="form-input" value={zoneForm.name}
                    onChange={e => setZ('name', e.target.value)}
                    placeholder="Receiving Bay" required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Zone Type</label>
                  <select className="form-input" value={zoneForm.zone_type} onChange={e => setZ('zone_type', e.target.value)}>
                    {ZONE_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                  </select>
                  <span className={styles.fieldHint}>Used for directed put-away and picking logic</span>
                </div>
                <div className="form-group">
                  <label className="form-label">Pick Sequence</label>
                  <input
                    className="form-input" type="number" min={0}
                    value={zoneForm.pick_sequence}
                    onChange={e => setZ('pick_sequence', e.target.value)}
                    placeholder="0"
                  />
                  <span className={styles.fieldHint}>Lower number = picked first</span>
                </div>

                <div className={styles.formActions}>
                  <button
                    type="button" className="btn btn-outline"
                    onClick={() => selectedZone ? setView(VIEW.BINS) : setView(VIEW.SELECT_ZONE)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={savingZone}>
                    {savingZone ? 'Saving...' : zoneIsNew ? 'Create Zone' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Bins view */}
          {view === VIEW.BINS && selectedZone && (
            <>
              <div className={styles.binHeader}>
                <div>
                  <div className={styles.binHeaderTitle}>
                    <span className={styles.zoneDot} style={{ background: ZONE_COLOR[selectedZone.zone_type], width: 10, height: 10 }} />
                    {selectedZone.name}
                    <span className={styles.zoneTypePill}>
                      {ZONE_TYPES.find(t => t.v === selectedZone.zone_type)?.l || selectedZone.zone_type}
                    </span>
                  </div>
                  <div className={styles.binHeaderSub}>
                    {selectedWarehouse.name} · {bins.length} bin{bins.length !== 1 ? 's' : ''}
                  </div>
                </div>
                <div className={styles.binHeaderActions}>
                  <button className="btn btn-outline btn-sm" onClick={() => openZoneForm(selectedZone)}>
                    Edit zone
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleZoneDeactivate(selectedZone)}>
                    Deactivate
                  </button>
                </div>
              </div>

              {loadingBins ? (
                <div className={styles.loading} style={{ padding: '20px 24px' }}>
                  <div className="spinner-dark" /> Loading bins...
                </div>
              ) : (
                <>
                  {bins.length === 0 && editingBin !== 'new' && (
                    <div className={styles.emptyBins}>No bins in this zone yet.</div>
                  )}

                  {bins.length > 0 && (
                    <table className={styles.binTable}>
                      <thead>
                        <tr>
                          <th>Bin Code</th>
                          <th>Type</th>
                          <th>Barcode</th>
                          <th>Seq</th>
                          <th>Limits</th>
                          <th>Status</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {bins.map(bin => (
                          <React.Fragment key={bin.id}>
                            <tr className={!bin.is_active ? styles.inactiveRow : ''}>
                              <td>
                                <span className={styles.binCode}>{bin.bin_code}</span>
                                {bin.is_locked && (
                                  <span className={styles.lockBadge} title={bin.lock_reason || 'Locked'}>
                                    <LockIcon />
                                  </span>
                                )}
                              </td>
                              <td>{BIN_TYPES.find(t => t.v === bin.bin_type)?.l || bin.bin_type}</td>
                              <td className={styles.mono}>{bin.barcode || '—'}</td>
                              <td className={styles.mono}>{bin.pick_sequence}</td>
                              <td className={styles.limits}>
                                {[
                                  bin.max_weight_kg ? `${bin.max_weight_kg}kg`  : null,
                                  bin.max_volume_m3 ? `${bin.max_volume_m3}m³`  : null,
                                  bin.max_units     ? `${bin.max_units}u`        : null,
                                ].filter(Boolean).join(' · ') || '—'}
                              </td>
                              <td>
                                {bin.is_active
                                  ? <span className="pill pill-green">Active</span>
                                  : <span className="pill pill-grey">Inactive</span>}
                              </td>
                              <td>
                                <div className={styles.rowActions}>
                                  <button className="btn btn-outline btn-sm" onClick={() => {
                                    setBinForm({
                                      bin_code:      bin.bin_code,
                                      barcode:       bin.barcode       ?? '',
                                      bin_type:      bin.bin_type,
                                      pick_sequence: bin.pick_sequence,
                                      notes:         bin.notes         ?? '',
                                      max_weight_kg: bin.max_weight_kg ?? '',
                                      max_volume_m3: bin.max_volume_m3 ?? '',
                                      max_units:     bin.max_units     ?? '',
                                    });
                                    setBinError('');
                                    setEditingBin(bin.id);
                                  }}>Edit</button>
                                  {bin.is_active && (
                                    <button className="btn btn-danger btn-sm" onClick={() => handleBinDeactivate(bin)}>
                                      Deactivate
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>

                            {editingBin === bin.id && (
                              <tr>
                                <td colSpan={7} style={{ padding: 0 }}>
                                  <BinForm
                                    form={binForm} set={setB} error={binError}
                                    saving={savingBin} onSave={handleBinSave}
                                    onCancel={() => setEditingBin(null)} isNew={false}
                                  />
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {editingBin === 'new' && (
                    <BinForm
                      form={binForm} set={setB} error={binError}
                      saving={savingBin} onSave={handleBinSave}
                      onCancel={() => setEditingBin(null)} isNew={true}
                    />
                  )}

                  {editingBin !== 'new' && (
                    <button
                      className={styles.addBinBtn}
                      onClick={() => { setBinForm(EMPTY_BIN); setBinError(''); setEditingBin('new'); }}
                    >
                      <PlusIcon /> Add Bin to {selectedZone.name}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Bin inline form ────────────────────────────────────────────

function BinForm({ form, set, error, saving, onSave, onCancel, isNew }) {
  return (
    <div className={styles.binForm}>
      {error && <div className={styles.formError}>{error}</div>}
      <form onSubmit={onSave}>
        <div className={styles.binFormGrid}>
          <div className="form-group">
            <label className="form-label">Bin Code *</label>
            <input
              className="form-input" value={form.bin_code} maxLength={50}
              onChange={e => set('bin_code', e.target.value.toUpperCase())}
              placeholder="A01-R01" disabled={!isNew} required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Type</label>
            <select className="form-input" value={form.bin_type} onChange={e => set('bin_type', e.target.value)}>
              {BIN_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Barcode</label>
            <input className="form-input" value={form.barcode} onChange={e => set('barcode', e.target.value)} placeholder="Optional" />
          </div>
          <div className="form-group">
            <label className="form-label">Pick Sequence</label>
            <input className="form-input" type="number" min={0} value={form.pick_sequence} onChange={e => set('pick_sequence', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Max Weight (kg)</label>
            <input className="form-input" type="number" min={0} step="0.01" value={form.max_weight_kg} onChange={e => set('max_weight_kg', e.target.value)} placeholder="Optional" />
          </div>
          <div className="form-group">
            <label className="form-label">Max Volume (m³)</label>
            <input className="form-input" type="number" min={0} step="0.001" value={form.max_volume_m3} onChange={e => set('max_volume_m3', e.target.value)} placeholder="Optional" />
          </div>
          <div className="form-group">
            <label className="form-label">Max Units</label>
            <input className="form-input" type="number" min={0} value={form.max_units} onChange={e => set('max_units', e.target.value)} placeholder="Optional" />
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <input className="form-input" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <div className={styles.formActions}>
          <button type="button" className="btn btn-outline btn-sm" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
            {saving ? 'Saving...' : isNew ? 'Create Bin' : 'Save Bin'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────
const ic = d => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;

function PlusIcon()         { return ic(<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>); }
function ChevronRightIcon() { return ic(<polyline points="9 18 15 12 9 6"/>); }
function ChevronDownIcon()  { return ic(<polyline points="6 9 12 15 18 9"/>); }
function LockIcon()         { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>; }
function WarehouseEmptyIcon() { return <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 22h22"/><rect x="3" y="10" width="18" height="12"/><path d="M3 10L12 3l9 7"/></svg>; }
function ZoneEmptyIcon()      { return <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>; }
