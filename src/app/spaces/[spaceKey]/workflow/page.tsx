'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  ChevronRight, Plus, Trash2, Edit2, Check, X, ZoomIn, ZoomOut,
  RotateCcw, Network, List, ArrowRight, ArrowLeft, Zap, GitMerge,
  LayoutGrid, GripVertical,
} from 'lucide-react';

// ─── Constants ───────────────────────────────────────────────────────────────
const CATEGORIES = [
  { value: 'todo',        label: 'To Do',       color: '#6B7280', bg: 'bg-gray-100',    text: 'text-gray-700',    ring: 'ring-gray-300'   },
  { value: 'in_progress', label: 'In Progress', color: '#3B82F6', bg: 'bg-blue-100',    text: 'text-blue-700',    ring: 'ring-blue-300'   },
  { value: 'done',        label: 'Done',        color: '#10B981', bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-300' },
];
const PRESET_COLORS = ['#6B7280','#3B82F6','#10B981','#8B5CF6','#F59E0B','#EF4444','#EC4899','#14B8A6','#F97316','#6366F1'];
const NODE_W = 160, NODE_H = 54, GAP_X = 150, GAP_Y = 160, PAD = 90;
type Pt = { x: number; y: number };

// ─── Layout ──────────────────────────────────────────────────────────────────
function computeLayout(statuses: any[]) {
  const groups: Record<string, any[]> = { todo: [], in_progress: [], done: [] };
  for (const s of statuses) { (groups[s.category] ?? groups.in_progress).push(s); }
  const rows    = [groups.todo, groups.in_progress, groups.done];
  const maxCols = Math.max(1, ...rows.map(r => r.length));
  const W       = maxCols * NODE_W + (maxCols - 1) * GAP_X + PAD * 2;
  const H       = 3 * NODE_H + 2 * GAP_Y + PAD * 2;
  const pos: Record<string, Pt> = {};
  rows.forEach((row, ri) => {
    const rowW = row.length * NODE_W + (row.length - 1) * GAP_X;
    const startX = (W - rowW) / 2;
    row.forEach((s, ci) => { pos[s.id] = { x: startX + ci * (NODE_W + GAP_X), y: PAD + ri * (NODE_H + GAP_Y) }; });
  });
  return { pos, W, H };
}

// ─── Arrow geometry ──────────────────────────────────────────────────────────
function getAnchors(from: Pt, to: Pt, off = 0): { src: Pt; dst: Pt } {
  const fc: Pt = { x: from.x + NODE_W / 2, y: from.y + NODE_H / 2 };
  const tc: Pt = { x: to.x   + NODE_W / 2, y: to.y   + NODE_H / 2 };
  const dx = tc.x - fc.x, dy = tc.y - fc.y;
  const len = Math.sqrt(dx*dx+dy*dy)||1;
  const nx = -dy/len*off, ny = dx/len*off;
  let src: Pt, dst: Pt;
  if (Math.abs(dy) >= Math.abs(dx)) {
    src = dy > 0 ? { x: fc.x+nx, y: from.y+NODE_H } : { x: fc.x+nx, y: from.y };
    dst = dy > 0 ? { x: tc.x+nx, y: to.y }           : { x: tc.x+nx, y: to.y+NODE_H };
  } else {
    src = dx > 0 ? { x: from.x+NODE_W, y: fc.y+ny } : { x: from.x,        y: fc.y+ny };
    dst = dx > 0 ? { x: to.x,          y: tc.y+ny } : { x: to.x+NODE_W,   y: tc.y+ny };
  }
  return { src, dst };
}
function makePath(src: Pt, dst: Pt, c = 0.5): string {
  const dx = dst.x-src.x, dy = dst.y-src.y;
  const v = Math.abs(dy) >= Math.abs(dx);
  let cx1:number,cy1:number,cx2:number,cy2:number;
  if (v) { const o=dy*c; cx1=src.x;cy1=src.y+o;cx2=dst.x;cy2=dst.y-o; }
  else   { const o=dx*c; cx1=src.x+o;cy1=src.y;cx2=dst.x-o;cy2=dst.y; }
  return `M ${src.x} ${src.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${dst.x} ${dst.y}`;
}
function midPt(src: Pt, dst: Pt, c = 0.5): Pt {
  const dx=dst.x-src.x, dy=dst.y-src.y;
  const v=Math.abs(dy)>=Math.abs(dx);
  let cx1:number,cy1:number,cx2:number,cy2:number;
  if (v){const o=dy*c;cx1=src.x;cy1=src.y+o;cx2=dst.x;cy2=dst.y-o;}
  else  {const o=dx*c;cx1=src.x+o;cy1=src.y;cx2=dst.x-o;cy2=dst.y;}
  const t=0.5,t2=t*t,t3=t2*t,u=1-t,u2=u*u,u3=u2*u;
  return {x:u3*src.x+3*u2*t*cx1+3*u*t2*cx2+t3*dst.x,y:u3*src.y+3*u2*t*cy1+3*u*t2*cy2+t3*dst.y};
}

// ─── Diagram ─────────────────────────────────────────────────────────────────
function WorkflowDiagram({ statuses, transitions, workflowId, onRefresh, spaceKey }: {
  statuses: any[]; transitions: any[]; workflowId: string; onRefresh: () => void; spaceKey: string;
}) {
  const [zoom,        setZoom]        = useState(0.85);
  const [showLabels,  setShowLabels]  = useState(false);
  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [hoveredId,   setHoveredId]   = useState<string | null>(null);
  const [editMode,       setEditMode]       = useState(false);
  const [addSource,      setAddSource]      = useState<string | null>(null);
  const [saving,         setSaving]         = useState(false);
  const [selectedTransId, setSelectedTransId] = useState<string | null>(null);

  // Add Status inline
  const [showAddStatus,  setShowAddStatus]  = useState(false);
  const [addName,        setAddName]        = useState('');
  const [addCategory,    setAddCategory]    = useState('in_progress');
  const [addColor,       setAddColor]       = useState('#6366F1');

  // Add Transition panel
  const [showAddTrans,  setShowAddTrans] = useState(false);
  const [transFromIds,  setTransFromIds] = useState<string[]>([]);
  const [transTo,       setTransTo]     = useState('');

  // Creating defaults
  const [creatingDefaults, setCreatingDefaults] = useState(false);

  // Save layout
  const [isDirty,    setIsDirty]    = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const layoutKey = `wf_layout_${workflowId}`;

  const saveLayout = () => {
    localStorage.setItem(layoutKey, JSON.stringify(customPos));
    setIsDirty(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  };

  const resetLayout = () => {
    localStorage.removeItem(layoutKey);
    setCustomPos({});
    setIsDirty(false);
  };

  // Drag & drop
  const [customPos, setCustomPos] = useState<Record<string, Pt>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(`wf_layout_${workflowId}`) || '{}'); } catch { return {}; }
  });
  const dragRef  = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const zoomRef  = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current) return;
    const { id, sx, sy, ox, oy } = dragRef.current;
    const dx = (e.clientX - sx) / zoomRef.current;
    const dy = (e.clientY - sy) / zoomRef.current;
    setCustomPos(prev => ({ ...prev, [id]: { x: Math.max(4, ox + dx), y: Math.max(4, oy + dy) } }));
    setIsDirty(true);
  }, []);

  const onMouseUp = useCallback(() => {
    dragRef.current = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }, [onMouseMove]);

  const startDrag = (e: React.MouseEvent, id: string, cur: Pt) => {
    if (editMode) return;
    e.preventDefault(); e.stopPropagation();
    dragRef.current = { id, sx: e.clientX, sy: e.clientY, ox: cur.x, oy: cur.y };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  useEffect(() => { return () => { document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); }; }, [onMouseMove, onMouseUp]);

  const { pos: basePos, W: baseW, H: baseH } = computeLayout(statuses);
  const getPos = (id: string) => customPos[id] ?? basePos[id] ?? { x: 50, y: 50 };

  // Dynamic canvas size
  const allPts = statuses.map(s => getPos(s.id));
  const canvasW = Math.max(baseW, ...allPts.map(p => p.x + NODE_W + PAD));
  const canvasH = Math.max(baseH, ...allPts.map(p => p.y + NODE_H + PAD));

  const focusId = selectedId ?? hoveredId;
  const focusFromIds = focusId ? transitions.filter(t => t.fromStatusId === focusId).map(t => t.toStatusId)   : [];
  const focusToIds   = focusId ? transitions.filter(t => t.toStatusId   === focusId).map(t => t.fromStatusId) : [];

  const handleNodeClick = async (id: string) => {
    setSelectedTransId(null); // always clear transition selection when clicking a node
    if (editMode) {
      if (!addSource) { setAddSource(id); return; }
      if (addSource === id) { setAddSource(null); return; }
      const exists = transitions.some(t => t.fromStatusId === addSource && t.toStatusId === id);
      if (!exists) {
        setSaving(true);
        try { await api.addTransition(workflowId, { fromStatusId: addSource, toStatusId: id, name: '' }); onRefresh(); }
        catch (e: any) { alert(e.message); }
        finally { setSaving(false); }
      }
      setAddSource(null);
    } else {
      setSelectedId(prev => { if (prev === id) { setConfirmDeleteStatus(false); return null; } setConfirmDeleteStatus(false); return id; });
    }
  };

  const [confirmDeleteStatus, setConfirmDeleteStatus] = useState(false);

  const handleSelectTransition = (tid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedTransId(prev => prev === tid ? null : tid);
    setSelectedId(null); // deselect node
  };

  const handleDeleteStatus = async (statusId: string) => {
    setSaving(true);
    try {
      await api.deleteWorkflowStatus(workflowId, statusId);
      setSelectedId(null);
      setConfirmDeleteStatus(false);
      onRefresh();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const handleDeleteTransition = async (tid: string) => {
    setSaving(true);
    try { await api.deleteTransition(workflowId, tid); setSelectedTransId(null); onRefresh(); }
    catch (er: any) { alert(er.message); }
    finally { setSaving(false); }
  };

  const handleAddStatus = async () => {
    if (!addName.trim()) return;
    setSaving(true);
    try {
      await api.addWorkflowStatus(workflowId, { name: addName.trim(), category: addCategory, color: addColor });
      setAddName(''); setAddCategory('in_progress'); setAddColor('#6366F1'); setShowAddStatus(false);
      onRefresh();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const handleAddTransition = async () => {
    if (transFromIds.length === 0 || !transTo) return;
    const toCreate = transFromIds.filter(fid =>
      fid !== transTo && !transitions.some(t => t.fromStatusId === fid && t.toStatusId === transTo)
    );
    if (toCreate.length === 0) { alert('All selected transitions already exist.'); return; }
    setSaving(true);
    try {
      for (const fid of toCreate) {
        await api.addTransition(workflowId, { fromStatusId: fid, toStatusId: transTo, name: '' });
      }
      setTransFromIds([]); setTransTo(''); setShowAddTrans(false); onRefresh();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const toggleFromId = (id: string) =>
    setTransFromIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const handleCreateDefaults = async () => {
    setCreatingDefaults(true);
    try { await api.createDefaultTransitions(workflowId); onRefresh(); }
    catch (e: any) { alert(e.message); }
    finally { setCreatingDefaults(false); }
  };

  const catMeta = (cat: string) => CATEGORIES.find(c => c.value === cat) || CATEGORIES[1];
  const selected = statuses.find(s => s.id === selectedId);

  return (
    <div>
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between mb-4 px-1 py-2.5 border-b border-gray-200">
        <div className="flex items-center gap-0.5">
          {/* Add status */}
          <button onClick={() => { setShowAddStatus(v => !v); setShowAddTrans(false); }}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors text-[13px] font-medium ${showAddStatus ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700'}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
            </svg>
            Add status
          </button>
          <div className="w-px h-6 bg-gray-200 mx-1" />
          {/* Add Transition */}
          <button onClick={() => { setShowAddTrans(v => !v); setShowAddStatus(false); }}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors text-[13px] font-medium ${showAddTrans ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700'}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" /><path d="M13 5l7 7-7 7" />
            </svg>
            Add Transition
          </button>
          <div className="w-px h-6 bg-gray-200 mx-1" />
          {/* Add Rule */}
          <Link href={`/spaces/${spaceKey}/automation`}
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors text-[13px] font-medium text-gray-700">
            <Zap size={16} strokeWidth={2} />
            Add Rule
          </Link>
          {transitions.length === 0 && (
            <>
              <div className="w-px h-6 bg-gray-200 mx-1" />
              <button onClick={handleCreateDefaults} disabled={creatingDefaults}
                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-amber-50 text-amber-600 transition-colors text-[13px] font-medium disabled:opacity-50">
                <LayoutGrid size={16} strokeWidth={2} />
                {creatingDefaults ? 'Creating…' : 'Auto Setup'}
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
            Show transition labels
          </label>
          <div className="w-px h-6 bg-gray-200 mx-1" />
          <button onClick={() => { setEditMode(v => !v); setAddSource(null); }}
            className={`px-3 py-1.5 text-sm font-semibold rounded-lg border transition-all ${editMode ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-300'}`}>
            {editMode ? '✓ Editing' : 'Edit Workflow'}
          </button>
          <div className="w-px h-6 bg-gray-200 mx-1" />
          {/* Save layout */}
          {savedFlash ? (
            <span className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg">
              <Check size={13} /> Saved!
            </span>
          ) : (
            <button onClick={saveLayout} disabled={!isDirty}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg border transition-all
                ${isDirty
                  ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700 shadow-sm'
                  : 'bg-white text-gray-400 border-gray-200 cursor-not-allowed'}`}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
              </svg>
              {isDirty ? 'Save Layout' : 'Saved'}
            </button>
          )}
          {Object.keys(customPos).length > 0 && !isDirty && (
            <button onClick={resetLayout} title="Reset to default layout"
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-red-500 hover:border-red-200 transition-all">
              <RotateCcw size={11} /> Reset
            </button>
          )}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-1.5 py-1">
            <button onClick={() => setZoom(z => Math.max(0.3, +(z-0.1).toFixed(1)))} className="p-1 text-gray-500 hover:text-gray-800"><ZoomOut size={13} /></button>
            <input type="range" min="0.3" max="1.8" step="0.1" value={zoom} onChange={e => setZoom(parseFloat(e.target.value))} className="w-20 accent-indigo-600" />
            <button onClick={() => setZoom(z => Math.min(1.8, +(z+0.1).toFixed(1)))} className="p-1 text-gray-500 hover:text-gray-800"><ZoomIn size={13} /></button>
            <button onClick={() => setZoom(0.85)} className="p-1 text-gray-400 hover:text-gray-600"><RotateCcw size={11} /></button>
            <span className="text-[11px] text-gray-400 w-8 text-right">{Math.round(zoom*100)}%</span>
          </div>
        </div>
      </div>

      {/* ── Add Status Panel ── */}
      {showAddStatus && (
        <div className="mb-4 bg-white border-2 border-indigo-200 rounded-2xl shadow-md p-5 max-w-[500px]">
          <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2"><Plus size={15} className="text-indigo-600" /> Add New Status</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block">Status Name *</label>
              <input value={addName} onChange={e => setAddName(e.target.value)} autoFocus
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-2 text-sm font-semibold focus:outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50"
                placeholder="e.g. Pending with QA"
                onKeyDown={e => { if (e.key==='Enter') handleAddStatus(); if (e.key==='Escape') setShowAddStatus(false); }} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block">Category</label>
              <div className="flex flex-col gap-1.5">
                {CATEGORIES.map(c => (
                  <button key={c.value} onClick={() => setAddCategory(c.value)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${addCategory===c.value ? `${c.bg} ${c.text} ring-2 ${c.ring}` : 'text-gray-500 hover:bg-gray-50 border border-gray-200'}`}>
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />{c.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block">Color</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {PRESET_COLORS.map(c => (
                  <button key={c} onClick={() => setAddColor(c)}
                    className={`w-6 h-6 rounded-full transition-all hover:scale-110 ${addColor===c ? 'ring-2 ring-offset-1 ring-gray-400 scale-110' : ''}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
              <input type="color" value={addColor} onChange={e => setAddColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
              <div className="mt-2">
                <p className="text-[10px] text-gray-500 mb-1">Preview</p>
                <span className="inline-block px-3 py-1 rounded-lg text-white text-xs font-bold" style={{ backgroundColor: addColor }}>{addName||'Status'}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={handleAddStatus} disabled={!addName.trim()||saving}
              className="flex-1 bg-indigo-600 text-white text-sm font-bold py-2 rounded-xl hover:bg-indigo-700 disabled:opacity-40 shadow-sm transition-all">
              {saving ? 'Adding…' : 'Create Status'}
            </button>
            <button onClick={() => { setShowAddStatus(false); setAddName(''); }}
              className="flex-1 bg-gray-100 text-gray-700 text-sm font-bold py-2 rounded-xl hover:bg-gray-200 transition-all">Cancel</button>
          </div>
        </div>
      )}

      {/* ── Add Transition Panel ── */}
      {showAddTrans && (
        <div className="mb-4 bg-white border-2 border-indigo-200 rounded-2xl shadow-md p-5 max-w-[620px]">
          <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
            <ArrowRight size={15} className="text-indigo-600" /> Add Transition
          </h3>
          <div className="grid grid-cols-2 gap-4">
            {/* ── From Status: multi-select checkbox list ── */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">From Status *</label>
                {transFromIds.length > 0 && (
                  <button onClick={() => setTransFromIds([])} className="text-[10px] text-indigo-500 hover:text-indigo-700 font-semibold">Clear all</button>
                )}
              </div>
              <div className="border-2 border-gray-200 rounded-xl overflow-hidden focus-within:border-indigo-400 bg-white">
                {/* Select All row */}
                <label className="flex items-center gap-2.5 px-3 py-2 bg-gray-50 border-b border-gray-100 cursor-pointer hover:bg-gray-100 transition-colors">
                  <input type="checkbox"
                    checked={transFromIds.length === statuses.filter(s => s.id !== transTo).length && statuses.filter(s => s.id !== transTo).length > 0}
                    onChange={e => {
                      const eligible = statuses.filter(s => s.id !== transTo).map(s => s.id);
                      setTransFromIds(e.target.checked ? eligible : []);
                    }}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5" />
                  <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Select All</span>
                  {transFromIds.length > 0 && (
                    <span className="ml-auto text-[10px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded-full">{transFromIds.length} selected</span>
                  )}
                </label>
                {/* Scrollable status list */}
                <div className="max-h-48 overflow-y-auto divide-y divide-gray-50">
                  {statuses.filter(s => s.id !== transTo).map(s => {
                    const checked = transFromIds.includes(s.id);
                    const alreadyExists = !!transTo && transitions.some(t => t.fromStatusId === s.id && t.toStatusId === transTo);
                    const cat = CATEGORIES.find(c => c.value === s.category) || CATEGORIES[1];
                    return (
                      <label key={s.id}
                        className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors select-none
                          ${alreadyExists ? 'opacity-40 cursor-not-allowed bg-gray-50' : checked ? 'bg-indigo-50 hover:bg-indigo-100' : 'hover:bg-gray-50'}`}>
                        <input type="checkbox" checked={checked} disabled={alreadyExists}
                          onChange={() => !alreadyExists && toggleFromId(s.id)}
                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 flex-shrink-0" />
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                        <span className={`text-sm font-semibold flex-1 ${checked ? 'text-indigo-700' : 'text-gray-700'}`}>{s.name}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cat.bg} ${cat.text}`}>{cat.label}</span>
                        {alreadyExists && <span className="text-[10px] text-gray-400 font-semibold">exists</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ── To Status ── */}
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 block">To Status *</label>
              <select value={transTo} onChange={e => { setTransTo(e.target.value); setTransFromIds(prev => prev.filter(id => id !== e.target.value)); }}
                className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm font-semibold focus:outline-none focus:border-indigo-400 bg-white">
                <option value="">Select status…</option>
                {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>

              {/* Preview arrows */}
              {transFromIds.length > 0 && transTo && (
                <div className="mt-3">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Preview ({transFromIds.length} transition{transFromIds.length > 1 ? 's' : ''})</p>
                  <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto pr-1">
                    {transFromIds.map(fid => {
                      const fs = statuses.find(s => s.id === fid);
                      const ts = statuses.find(s => s.id === transTo);
                      if (!fs || !ts) return null;
                      return (
                        <div key={fid} className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-white text-[11px] font-bold truncate max-w-[110px]" style={{ backgroundColor: fs.color }}>{fs.name}</span>
                          <ArrowRight size={14} className="text-indigo-400 flex-shrink-0" />
                          <span className="px-2 py-0.5 rounded text-white text-[11px] font-bold truncate max-w-[110px]" style={{ backgroundColor: ts.color }}>{ts.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <button onClick={handleAddTransition}
              disabled={transFromIds.length === 0 || !transTo || saving}
              className="flex-1 bg-indigo-600 text-white text-sm font-bold py-2 rounded-xl hover:bg-indigo-700 disabled:opacity-40 shadow-sm transition-all">
              {saving ? 'Adding…' : `Add ${transFromIds.length > 1 ? transFromIds.length + ' Transitions' : 'Transition'}`}
            </button>
            <button onClick={() => { setShowAddTrans(false); setTransFromIds([]); setTransTo(''); }}
              className="flex-1 bg-gray-100 text-gray-700 text-sm font-bold py-2 rounded-xl hover:bg-gray-200 transition-all">Cancel</button>
          </div>
          <p className="text-[11px] text-gray-400 mt-3">💡 In <strong>Edit Workflow</strong> mode you can also click a source node then a target node on the diagram to add a transition.</p>
        </div>
      )}

      {/* ── Selection info panel ── */}
      {selected ? (() => {
        const totalLinked = transitions.filter(t => t.fromStatusId === selected.id || t.toStatusId === selected.id).length;
        const cat = catMeta(selected.category);
        return (
          <div className="mb-3 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            {/* Top bar */}
            <div className="flex items-center gap-3 px-5 py-2.5 border-b border-gray-100 bg-gray-50">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: selected.color }} />
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Status Selected</span>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${cat.bg} ${cat.text}`}>{cat.label}</span>
              <button onClick={() => { setSelectedId(null); setConfirmDeleteStatus(false); }} className="ml-auto text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-200 transition-colors">
                <X size={14} />
              </button>
            </div>

            {/* Body */}
            <div className="flex items-start">
              {/* Left: transitions info */}
              <div className="flex-1 px-5 py-4 flex flex-wrap items-start gap-8">
                {/* Current status badge */}
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Current Status</p>
                  <span className="inline-block px-3 py-1.5 rounded-lg text-xs font-bold text-white shadow-sm" style={{ backgroundColor: selected.color }}>
                    {selected.name.toUpperCase()}
                  </span>
                </div>

                {/* Move to */}
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                    This work item can be moved to
                    {focusFromIds.length > 0 && <span className="ml-1.5 text-[9px] bg-gray-100 text-gray-600 font-black px-1.5 py-0.5 rounded-full">{focusFromIds.length}</span>}
                  </p>
                  {focusFromIds.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {focusFromIds.map(id => { const s=statuses.find(x=>x.id===id); return s ? (
                        <span key={id} className="px-2.5 py-1 rounded border border-gray-300 text-xs font-bold text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 cursor-pointer transition-colors"
                          onClick={() => { setSelectedId(id); setConfirmDeleteStatus(false); }}>
                          {s.name.toUpperCase()}
                        </span>
                      ) : null; })}
                    </div>
                  ) : <span className="text-xs text-gray-400 italic">No outgoing transitions</span>}
                </div>

                {/* Can be reached from */}
                {focusToIds.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                      Can be reached from
                      <span className="ml-1.5 text-[9px] bg-indigo-50 text-indigo-600 font-black px-1.5 py-0.5 rounded-full">{focusToIds.length}</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {focusToIds.map(id => { const s=statuses.find(x=>x.id===id); return s ? (
                        <span key={id} className="px-2.5 py-1 rounded border border-indigo-200 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 cursor-pointer transition-colors"
                          onClick={() => { setSelectedId(id); setConfirmDeleteStatus(false); }}>
                          {s.name.toUpperCase()}
                        </span>
                      ) : null; })}
                    </div>
                  </div>
                )}
              </div>

              {/* Right: delete section */}
              <div className="border-l border-gray-100 px-5 py-4 flex flex-col gap-3 min-w-[200px] bg-gray-50/60">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Actions</p>

                {/* Transition count badge */}
                <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                    <ArrowRight size={14} className="text-indigo-500" />
                  </div>
                  <div>
                    <p className="text-base font-black text-gray-800 leading-none">{totalLinked}</p>
                    <p className="text-[10px] text-gray-400 font-semibold">linked transition{totalLinked !== 1 ? 's' : ''}</p>
                  </div>
                </div>

                {/* Delete flow */}
                {!confirmDeleteStatus ? (
                  <button onClick={() => setConfirmDeleteStatus(true)}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 text-red-500 text-xs font-bold hover:bg-red-50 hover:border-red-300 transition-all">
                    <Trash2 size={13} /> Delete Status
                  </button>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-[11px] text-red-700 font-semibold leading-snug">
                      {totalLinked > 0
                        ? <>⚠️ This will also delete <strong>{totalLinked} transition{totalLinked !== 1 ? 's' : ''}</strong> linked to this status.</>
                        : <>Are you sure you want to delete <strong>"{selected.name}"</strong>?</>}
                    </div>
                    <button onClick={() => handleDeleteStatus(selected.id)} disabled={saving}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-bold shadow-sm transition-all disabled:opacity-50">
                      <Trash2 size={12} /> {saving ? 'Deleting…' : 'Yes, Delete'}
                    </button>
                    <button onClick={() => setConfirmDeleteStatus(false)}
                      className="px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-bold transition-all">
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })() : (
        <div className="mb-3 px-4 py-2.5 bg-gray-50 border border-dashed border-gray-300 rounded-xl text-sm text-gray-400 flex items-center gap-3">
          <GripVertical size={14} className="text-gray-300" />
          <span>Click a node to inspect transitions • Drag nodes to rearrange</span>
          {editMode && <span className="text-indigo-600 font-semibold">• Edit mode: click source → click target to add transition</span>}
        </div>
      )}

      {/* ── Transition Detail Panel ── */}
      {(() => {
        const selTrans = selectedTransId ? transitions.find(t => t.id === selectedTransId) : null;
        if (!selTrans) return null;
        const fromStatus  = statuses.find(s => s.id === selTrans.fromStatusId);
        const toStatus    = statuses.find(s => s.id === selTrans.toStatusId);
        const outgoing    = transitions.filter(t => t.fromStatusId === selTrans.fromStatusId);
        const incoming    = transitions.filter(t => t.toStatusId   === selTrans.toStatusId);
        const fromIncoming= transitions.filter(t => t.toStatusId   === selTrans.fromStatusId);
        const toOutgoing  = transitions.filter(t => t.fromStatusId === selTrans.toStatusId);
        const catFrom = CATEGORIES.find(c => c.value === fromStatus?.category) || CATEGORIES[1];
        const catTo   = CATEGORIES.find(c => c.value === toStatus?.category)   || CATEGORIES[1];
        return (
          <div className="mb-3 bg-white border-2 border-amber-300 rounded-2xl shadow-md overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 bg-amber-50 border-b border-amber-200">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center">
                  <ArrowRight size={14} className="text-amber-600" />
                </div>
                <div>
                  <p className="text-xs font-bold text-amber-800">Transition Selected</p>
                  <p className="text-[11px] text-amber-600">Click on the diagram to deselect</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleDeleteTransition(selTrans.id)} disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-lg shadow-sm transition-all disabled:opacity-50">
                  <Trash2 size={12} /> {saving ? 'Deleting…' : 'Delete Transition'}
                </button>
                <button onClick={() => setSelectedTransId(null)} className="p-1.5 rounded-lg hover:bg-amber-100 text-amber-600">
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="px-5 py-4 flex flex-wrap items-start gap-8">
              {/* Transition arrow */}
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">FROM</span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-white text-xs font-bold shadow-sm" style={{ backgroundColor: fromStatus?.color }}>
                    {fromStatus?.name}
                  </span>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full mt-0.5 ${catFrom.bg} ${catFrom.text}`}>{catFrom.label}</span>
                </div>
                <div className="flex flex-col items-center gap-1 mt-2">
                  <div className="w-10 h-[2px] bg-amber-400 relative">
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 border-l-[6px] border-l-amber-400 border-y-[4px] border-y-transparent" />
                  </div>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">TO</span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-white text-xs font-bold shadow-sm" style={{ backgroundColor: toStatus?.color }}>
                    {toStatus?.name}
                  </span>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full mt-0.5 ${catTo.bg} ${catTo.text}`}>{catTo.label}</span>
                </div>
              </div>

              {/* Divider */}
              <div className="w-px self-stretch bg-gray-100" />

              {/* From status stats */}
              <div className="flex flex-col gap-2 min-w-[140px]">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: fromStatus?.color }} />
                  {fromStatus?.name} links
                </p>
                <div className="flex gap-3">
                  <div className="flex flex-col items-center bg-gray-50 rounded-xl px-3 py-2 border border-gray-100 min-w-[56px]">
                    <span className="text-xl font-black text-gray-800">{outgoing.length}</span>
                    <span className="text-[9px] font-bold text-gray-400 uppercase">Outgoing</span>
                  </div>
                  <div className="flex flex-col items-center bg-gray-50 rounded-xl px-3 py-2 border border-gray-100 min-w-[56px]">
                    <span className="text-xl font-black text-gray-800">{fromIncoming.length}</span>
                    <span className="text-[9px] font-bold text-gray-400 uppercase">Incoming</span>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="w-px self-stretch bg-gray-100" />

              {/* To status stats */}
              <div className="flex flex-col gap-2 min-w-[140px]">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: toStatus?.color }} />
                  {toStatus?.name} links
                </p>
                <div className="flex gap-3">
                  <div className="flex flex-col items-center bg-gray-50 rounded-xl px-3 py-2 border border-gray-100 min-w-[56px]">
                    <span className="text-xl font-black text-gray-800">{toOutgoing.length}</span>
                    <span className="text-[9px] font-bold text-gray-400 uppercase">Outgoing</span>
                  </div>
                  <div className="flex flex-col items-center bg-gray-50 rounded-xl px-3 py-2 border border-gray-100 min-w-[56px]">
                    <span className="text-xl font-black text-gray-800">{incoming.length}</span>
                    <span className="text-[9px] font-bold text-gray-400 uppercase">Incoming</span>
                  </div>
                </div>
              </div>

              {/* All transitions for From → * */}
              <div className="flex flex-col gap-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">All transitions from "{fromStatus?.name}"</p>
                <div className="flex flex-wrap gap-1.5 max-w-[300px]">
                  {outgoing.map(ot => {
                    const ts = statuses.find(s => s.id === ot.toStatusId);
                    if (!ts) return null;
                    return (
                      <button key={ot.id} onClick={e => handleSelectTransition(ot.id, e)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] font-bold transition-all
                          ${ot.id === selTrans.id ? 'bg-amber-100 border-amber-400 text-amber-800' : 'bg-white border-gray-200 text-gray-600 hover:border-indigo-300 hover:bg-indigo-50'}`}>
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: ts.color }} />
                        {ts.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Diagram Canvas ── */}
      <div className="overflow-auto border border-gray-200 rounded-2xl bg-[#f8fafc]" style={{ minHeight: 460, maxHeight: 620 }}>
        <div style={{ width: canvasW * zoom, height: canvasH * zoom, position: 'relative', minWidth: '100%' }}>
          <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: canvasW, height: canvasH, position: 'relative' }}>

            {/* Dot grid */}
            <svg style={{ position:'absolute',top:0,left:0,width:canvasW,height:canvasH,pointerEvents:'none',zIndex:0 }}>
              <defs><pattern id="grid" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="#DDE1E7" />
              </pattern></defs>
              <rect width={canvasW} height={canvasH} fill="url(#grid)" />
            </svg>

            {/* Category labels */}
            {CATEGORIES.map((cat, ri) => (
              <div key={cat.value} style={{ position:'absolute', left:8, top: PAD + ri*(NODE_H+GAP_Y) + (NODE_H/2-8), zIndex:1 }}
                className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: cat.color }}>{cat.label}</span>
              </div>
            ))}

            {/* Arrows SVG */}
            <svg style={{ position:'absolute',top:0,left:0,width:canvasW,height:canvasH,pointerEvents:'all',zIndex:2 }}
              onClick={() => { setSelectedTransId(null); }}>
              <defs>
                <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                  <path d="M0 1.5L9 5L0 8.5z" fill="#475569" /></marker>
                <marker id="ahHL" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                  <path d="M0 1.5L9 5L0 8.5z" fill="#6366F1" /></marker>
                <marker id="ahSel" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
                  <path d="M0 1.5L9 5L0 8.5z" fill="#F59E0B" /></marker>
              </defs>
              {transitions.map(t => {
                const fp = getPos(t.fromStatusId), tp = getPos(t.toStatusId);
                if (!fp || !tp || t.fromStatusId === t.toStatusId) return null;
                const hasRev = transitions.some(x => x.fromStatusId===t.toStatusId && x.toStatusId===t.fromStatusId);
                const { src, dst } = getAnchors(fp, tp, hasRev ? 13 : 0);
                const d = makePath(src, dst);
                const mp = midPt(src, dst);
                const isSel  = selectedTransId === t.id;
                const isHL   = !isSel && !!(focusId && (t.fromStatusId===focusId || t.toStatusId===focusId));
                const opacity = isSel ? 1 : (focusId ? (isHL ? 1 : 0.12) : 0.55);
                const stroke  = isSel ? '#F59E0B' : (isHL ? '#6366F1' : '#475569');
                const sw      = isSel ? 2.6 : (isHL ? 2.2 : 1.5);
                const marker  = isSel ? 'ahSel' : (isHL ? 'ahHL' : 'ah');
                return (
                  <g key={t.id} style={{ cursor: 'pointer' }}
                    onClick={e => handleSelectTransition(t.id, e)}>
                    {/* Wide invisible hit area */}
                    <path d={d} fill="none" stroke="transparent" strokeWidth={16} />
                    <path d={d} fill="none" stroke={stroke} strokeWidth={sw} opacity={opacity} markerEnd={`url(#${marker})`} />
                    {/* Mid-point badge: shows click indicator or delete button */}
                    <g opacity={opacity}>
                      <circle cx={mp.x} cy={mp.y} r={isSel ? 10 : 7} fill={isSel ? '#FEF3C7' : 'white'}
                        stroke={isSel ? '#F59E0B' : '#CBD5E1'} strokeWidth={isSel ? 2 : 1.2} />
                      {isSel
                        ? <text x={mp.x} y={mp.y+4} textAnchor="middle" fontSize={11} fill="#92400E" fontWeight="bold">✕</text>
                        : <text x={mp.x} y={mp.y+3.5} textAnchor="middle" fontSize={9} fill="#94A3B8">→</text>
                      }
                    </g>
                    {showLabels && t.name && <text x={mp.x+4} y={mp.y-12} fontSize={9} fill="#64748B" opacity={opacity}>{t.name}</text>}
                  </g>
                );
              })}
            </svg>

            {/* Status nodes */}
            {statuses.map(s => {
              const p = getPos(s.id);
              const isSelected = selectedId === s.id;
              const isSource   = addSource === s.id;
              const isTo       = focusFromIds.includes(s.id);
              const isFrom     = focusToIds.includes(s.id);
              let border = 'border-gray-200 bg-white';
              if (isSelected)  border = 'border-indigo-500 bg-indigo-50 shadow-xl shadow-indigo-100';
              else if (isSource)      border = 'border-green-500 bg-green-50 shadow-lg shadow-green-100';
              else if (isTo)          border = 'border-indigo-300 bg-indigo-50/70 shadow-md';
              else if (isFrom)        border = 'border-purple-300 bg-purple-50/70 shadow-md';
              const cat = catMeta(s.category);
              return (
                <div key={s.id}
                  style={{ position:'absolute', left: p.x, top: p.y, width: NODE_W, height: NODE_H, zIndex: isSelected||isSource ? 20 : 10, cursor: editMode ? 'pointer' : 'grab' }}
                  onMouseDown={e => startDrag(e, s.id, p)}
                  onClick={() => handleNodeClick(s.id)}
                  onMouseEnter={() => setHoveredId(s.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={`flex flex-col items-center justify-center rounded-xl border-2 select-none transition-shadow duration-100 group ${border}`}>
                  <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl" style={{ backgroundColor: s.color }} />
                  <span className="text-[13px] font-bold text-gray-800 truncate px-3 w-full text-center leading-tight">{s.name}</span>
                  <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full mt-0.5 ${cat.bg} ${cat.text}`}>{cat.label}</span>
                  {isSource && <div className="absolute -top-2.5 -right-2.5 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center text-white text-[9px] font-bold shadow">1</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 mt-3 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <svg width="26" height="10"><line x1="0" y1="5" x2="18" y2="5" stroke="#475569" strokeWidth="1.5" opacity="0.55" /><polygon points="16,2 22,5 16,8" fill="#475569" opacity="0.55" /></svg>
          Transition
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="26" height="10"><line x1="0" y1="5" x2="18" y2="5" stroke="#6366F1" strokeWidth="2" /><polygon points="16,2 22,5 16,8" fill="#6366F1" /></svg>
          Selected
        </div>
        <div className="flex items-center gap-1.5"><GripVertical size={12} className="text-gray-400" /> Drag to move nodes</div>
        {transitions.length === 0 && (
          <button onClick={handleCreateDefaults} disabled={creatingDefaults}
            className="ml-auto px-4 py-1.5 bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 disabled:opacity-50 shadow-sm">
            {creatingDefaults ? 'Creating…' : '⚡ Auto-create default transitions'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function WorkflowPage() {
  const params   = useParams();
  const spaceKey = (params.spaceKey as string).toUpperCase();

  const [tab,         setTab]         = useState<'diagram'|'statuses'>('diagram');
  const [space,       setSpace]       = useState<any>(null);
  const [workflowId,  setWorkflowId]  = useState<string|null>(null);
  const [statuses,    setStatuses]    = useState<any[]>([]);
  const [transitions, setTransitions] = useState<any[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');

  // Status edit state (for Statuses tab)
  const [editingId,    setEditingId]    = useState<string|null>(null);
  const [editName,     setEditName]     = useState('');
  const [editCategory, setEditCategory] = useState('in_progress');
  const [editColor,    setEditColor]    = useState('#6B7280');
  const [saving,       setSaving]       = useState(false);

  useEffect(() => { loadData(); }, [spaceKey]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [spaceData, wfList] = await Promise.all([api.getSpace(spaceKey), api.getWorkflows(spaceKey)]);
      setSpace(spaceData);
      if (wfList.length > 0) {
        const wfId = wfList[0].id;
        setWorkflowId(wfId);
        const wfData = await api.getWorkflowStatuses(wfId);
        setStatuses(wfData.statuses || []);
        setTransitions(wfData.transitions || []);
      }
    } catch (e: any) { setError(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  };

  const handleEditSave = async (id: string) => {
    if (!editName.trim() || !workflowId) return;
    setSaving(true);
    try {
      await api.updateWorkflowStatus(workflowId, id, { name: editName.trim(), category: editCategory, color: editColor });
      setEditingId(null); await loadData();
    } catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };
  const handleDelete = async (id: string, name: string) => {
    if (!workflowId || !confirm(`Delete status "${name}"?`)) return;
    try { await api.deleteWorkflowStatus(workflowId, id); await loadData(); }
    catch (e: any) { alert(e.message); }
  };
  const handleMove = async (idx: number, dir: -1|1) => {
    if (!workflowId) return;
    const next = idx + dir;
    if (next < 0 || next >= statuses.length) return;
    const newOrder = [...statuses];
    [newOrder[idx], newOrder[next]] = [newOrder[next], newOrder[idx]];
    setStatuses(newOrder);
    await api.reorderStatuses(workflowId, newOrder.map(s => s.id));
  };
  const getCatMeta = (cat: string) => CATEGORIES.find(c => c.value === cat) || CATEGORIES[1];

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-[3px] border-indigo-600 border-t-transparent rounded-full" /></div>;
  if (error)   return <div className="p-8 text-red-500 text-sm">{error}</div>;

  return (
    <div className="max-w-[1400px] mx-auto px-2">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[13px] mb-4 mt-4 text-gray-500">
        <Link href="/spaces" className="hover:text-indigo-600 hover:underline">Spaces</Link>
        <ChevronRight size={12} className="text-gray-400" />
        <Link href={`/spaces/${spaceKey}`} className="hover:text-indigo-600 hover:underline">{space?.name ?? spaceKey}</Link>
        <ChevronRight size={12} className="text-gray-400" />
        <span className="text-gray-900 font-semibold">Workflow</span>
      </div>

      {/* Page Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{space?.name} Workflow</h1>
          <p className="text-xs text-gray-500 mt-1">Used in 1 space · {statuses.length} statuses · {transitions.length} transitions</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-gray-200 mb-0">
        <button onClick={() => setTab('diagram')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-[3px] transition-all ${tab==='diagram' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          <Network size={15} /> Diagram
        </button>
        <button onClick={() => setTab('statuses')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-[3px] transition-all ${tab==='statuses' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          <List size={15} /> Statuses ({statuses.length})
        </button>
      </div>

      {/* ── DIAGRAM TAB ── */}
      {tab === 'diagram' && workflowId && (
        <WorkflowDiagram
          statuses={statuses} transitions={transitions}
          workflowId={workflowId} onRefresh={loadData} spaceKey={spaceKey}
        />
      )}

      {/* ── STATUSES TAB ── */}
      {tab === 'statuses' && (
        <div className="pt-5">
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900">All Statuses</h2>
              <span className="text-xs text-gray-400 font-medium">{statuses.length} total</span>
            </div>
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-6 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider w-8">#</th>
                  <th className="text-left px-6 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="text-left px-6 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Category</th>
                  <th className="text-left px-6 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Color</th>
                  <th className="text-right px-6 py-3 text-[11px] font-bold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {statuses.map((s, idx) => {
                  const cat = getCatMeta(s.category);
                  const isEditing = editingId === s.id;
                  return (
                    <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors group">
                      <td className="px-6 py-3 text-xs font-medium text-gray-400">{idx+1}</td>
                      <td className="px-6 py-3">
                        {isEditing ? (
                          <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                            className="border-2 border-indigo-300 rounded-lg px-3 py-1 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-200 w-48"
                            onKeyDown={e => { if (e.key==='Enter') handleEditSave(s.id); if (e.key==='Escape') setEditingId(null); }} />
                        ) : (
                          <div className="flex items-center gap-3">
                            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                            <span className="text-sm font-semibold text-gray-900">{s.name}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        {isEditing ? (
                          <select value={editCategory} onChange={e => setEditCategory(e.target.value)}
                            className="border-2 border-indigo-300 rounded-lg px-2 py-1 text-sm focus:outline-none bg-white">
                            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                          </select>
                        ) : (
                          <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${cat.bg} ${cat.text}`}>{cat.label}</span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <div className="flex flex-wrap gap-1.5">
                              {PRESET_COLORS.map(c => (
                                <button key={c} onClick={() => setEditColor(c)}
                                  className={`w-5 h-5 rounded-full transition-all hover:scale-110 ${editColor===c?'ring-2 ring-offset-1 ring-gray-400 scale-110':''}`}
                                  style={{ backgroundColor: c }} />
                              ))}
                            </div>
                            <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)} className="w-7 h-7 rounded cursor-pointer" />
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full shadow-sm" style={{ backgroundColor: s.color }} />
                            <span className="text-xs text-gray-400 font-mono">{s.color}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {isEditing ? (
                            <>
                              <button onClick={() => handleEditSave(s.id)} disabled={saving} className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100"><Check size={13} /></button>
                              <button onClick={() => setEditingId(null)} className="p-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200"><X size={13} /></button>
                            </>
                          ) : (
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                              <button onClick={() => handleMove(idx, -1)} disabled={idx===0} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"><ArrowLeft size={13} /></button>
                              <button onClick={() => handleMove(idx, 1)} disabled={idx===statuses.length-1} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"><ArrowRight size={13} /></button>
                              <button onClick={() => { setEditingId(s.id); setEditName(s.name); setEditCategory(s.category); setEditColor(s.color); }} className="p-1.5 rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-indigo-600"><Edit2 size={13} /></button>
                              <button onClick={() => handleDelete(s.id, s.name)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
