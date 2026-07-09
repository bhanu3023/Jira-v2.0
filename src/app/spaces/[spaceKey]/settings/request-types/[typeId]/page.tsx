'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, Mail, GripVertical, ChevronRight, MoreHorizontal,
  AlignLeft, Type, Search, ExternalLink, Plus, X, Info,
  Shield, GitBranch, Eye, Save
} from 'lucide-react';

// ── Field row types ───────────────────────────────────────────────────────────
interface RequestField {
  id: string;
  name: string;
  icon: 'text' | 'paragraph' | 'instructions';
  label: string;
  required: boolean;
  removable: boolean;
}

const AVAILABLE_FIELDS = [
  { name: '[CHART] Date of First Response', group: 'Date and time fields' },
  { name: '[CHART] Time in Status',         group: 'Date and time fields' },
  { name: 'Baseline end date',              group: 'Date and time fields' },
  { name: 'Baseline start date',            group: 'Date and time fields' },
  { name: 'Begin Date',                     group: 'Date and time fields' },
  { name: 'CF Resolved Time',               group: 'Date and time fields' },
  { name: 'CF Start Time',                  group: 'Date and time fields' },
  { name: 'Change completion date',         group: 'Date and time fields' },
  { name: 'Change start date',              group: 'Date and time fields' },
  { name: 'Due date',                       group: 'Date and time fields' },
  { name: 'Assignee',                       group: 'People fields' },
  { name: 'Reporter',                       group: 'People fields' },
  { name: 'Priority',                       group: 'Other fields' },
  { name: 'Labels',                         group: 'Other fields' },
  { name: 'Attachment',                     group: 'Other fields' },
  { name: 'Story Points',                   group: 'Other fields' },
];

// ── Workflow statuses for the tab ─────────────────────────────────────────────
const WORKFLOW_STATUSES = [
  { name: 'To Do',       category: 'TODO',        color: '#64748B' },
  { name: 'In Progress', category: 'IN PROGRESS',  color: '#3B82F6' },
  { name: 'Done',        category: 'DONE',         color: '#10B981' },
];

export default function RequestTypePage() {
  const params   = useParams();
  const spaceKey = (params.spaceKey as string).toUpperCase();

  const [activeTab,   setActiveTab]   = useState<'form' | 'view' | 'statuses'>('form');
  const [description, setDescription] = useState('Request received from your email support channel.');
  const [fieldSearch, setFieldSearch] = useState('');
  const [saved,       setSaved]       = useState(false);
  const [dirty,       setDirty]       = useState(false);
  const [fieldMenuId, setFieldMenuId] = useState<string | null>(null);

  const [fields, setFields] = useState<RequestField[]>([
    { id: 'instructions', name: 'Instructions',  icon: 'instructions', label: '',        required: false, removable: false },
    { id: 'summary',      name: 'Summary',        icon: 'text',         label: 'Subject', required: true,  removable: false },
    { id: 'description',  name: 'Description',    icon: 'paragraph',    label: 'Body',    required: false, removable: true  },
  ]);

  const filteredAvailable = AVAILABLE_FIELDS.filter(f =>
    f.name.toLowerCase().includes(fieldSearch.toLowerCase())
  );

  // Group available fields by category
  const grouped = filteredAvailable.reduce<Record<string, string[]>>((acc, f) => {
    if (!acc[f.group]) acc[f.group] = [];
    acc[f.group].push(f.name);
    return acc;
  }, {});

  const addField = (name: string) => {
    const already = fields.find(f => f.name === name);
    if (already) return;
    setFields(prev => [...prev, { id: name.toLowerCase().replace(/\s+/g, '_'), name, icon: 'text', label: name, required: false, removable: true }]);
    setDirty(true);
  };

  const removeField = (id: string) => {
    setFields(prev => prev.filter(f => f.id !== id));
    setDirty(true);
  };

  const toggleRequired = (id: string) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, required: !f.required } : f));
    setDirty(true);
  };

  const handleSave = () => {
    setSaved(true);
    setDirty(false);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="min-h-screen bg-white" onClick={() => setFieldMenuId(null)}>

      {/* ── Top bar ── */}
      <div className="border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/spaces/${spaceKey}/settings?tab=email`}
            className="flex items-center gap-1.5 text-[13px] font-medium text-gray-600 hover:text-blue-600 transition-colors px-2 py-1 rounded hover:bg-blue-50"
          >
            <ArrowLeft size={14} strokeWidth={2.5} /> Back to request types
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded text-[13px] text-gray-700 hover:bg-gray-50">
            <Shield size={13} /> Restrictions
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded text-[13px] text-gray-700 hover:bg-gray-50">
            <GitBranch size={13} /> Manage workflow <ChevronRight size={12} className="rotate-90" />
          </button>
        </div>
      </div>

      {/* ── Page title ── */}
      <div className="px-8 pt-6 pb-0">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded bg-blue-600 flex items-center justify-center flex-shrink-0">
            <Mail size={16} className="text-white" />
          </div>
          <h1 className="text-[22px] font-bold text-gray-900">Emailed request</h1>
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-0 border-b border-gray-200">
          {[
            { id: 'form',     label: 'Request form' },
            { id: 'view',     label: 'Work item view' },
            { id: 'statuses', label: 'Workflow statuses' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2.5 text-[13.5px] font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab: Request form ── */}
      {activeTab === 'form' && (
        <div className="flex" style={{ minHeight: 'calc(100vh - 200px)' }}>

          {/* Main content */}
          <div className="flex-1 px-8 py-6">
            <p className="text-[13px] text-gray-600 mb-4">
              Fields added to the request form are filled out by customers when they raise a request from the portal.{' '}
              <span className="text-blue-600 hover:underline cursor-pointer inline-flex items-center gap-0.5">
                Learn more about the portal <ExternalLink size={11} />
              </span>
              {', or '}
              <span className="text-blue-600 hover:underline cursor-pointer inline-flex items-center gap-0.5">
                how to customize fields <ExternalLink size={11} />
              </span>.
            </p>

            {/* Description */}
            <div className="mb-5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <label className="text-[13px] font-semibold text-gray-700">Request type description</label>
                <Info size={13} className="text-gray-400" />
              </div>
              <textarea
                value={description}
                onChange={e => { setDescription(e.target.value); setDirty(true); }}
                rows={2}
                className="w-full border border-gray-300 rounded px-3 py-2 text-[13px] text-gray-800 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Suggest fields button */}
            <div className="flex justify-end mb-3">
              <button className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded text-[13px] text-gray-700 hover:bg-gray-50">
                ✦ Suggest fields
              </button>
            </div>

            {/* Fields list */}
            <div className="border border-gray-200 rounded-lg overflow-hidden mb-5">
              {fields.map((field, idx) => (
                <div key={field.id} className="flex items-center gap-2 px-4 py-3 bg-white border-b border-gray-100 last:border-b-0 hover:bg-gray-50 group">
                  {/* Drag handle */}
                  <GripVertical size={14} className="text-gray-300 group-hover:text-gray-400 flex-shrink-0 cursor-grab" />

                  {/* Icon */}
                  <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                    {field.icon === 'text'         && <Type size={14} className="text-gray-500" />}
                    {field.icon === 'paragraph'    && <AlignLeft size={14} className="text-gray-500" />}
                    {field.icon === 'instructions' && <AlignLeft size={14} className="text-gray-500" />}
                  </div>

                  {/* Field name */}
                  <span className="text-[13.5px] text-gray-800 flex-1 font-medium">{field.name}</span>

                  {/* Label tag */}
                  {field.label && (
                    <span className="text-[12px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{field.label}</span>
                  )}

                  {/* Required badge */}
                  {field.required && (
                    <span className="text-[11px] font-bold text-gray-700 border border-gray-300 px-1.5 py-0.5 rounded uppercase tracking-wide">
                      Required
                    </span>
                  )}

                  {/* Actions */}
                  <div className="relative flex items-center gap-1 ml-1" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => setFieldMenuId(fieldMenuId === field.id ? null : field.id)}
                      className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreHorizontal size={15} />
                    </button>
                    <button className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 opacity-0 group-hover:opacity-100 transition-opacity">
                      <ChevronRight size={15} />
                    </button>

                    {/* Field context menu */}
                    {fieldMenuId === field.id && (
                      <div className="absolute right-0 top-7 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-44">
                        <button
                          onClick={() => { toggleRequired(field.id); setFieldMenuId(null); }}
                          className="w-full text-left px-4 py-2 text-[13px] text-gray-700 hover:bg-gray-50"
                        >
                          {field.required ? 'Make optional' : 'Make required'}
                        </button>
                        {field.removable && (
                          <>
                            <div className="border-t border-gray-100 my-1" />
                            <button
                              onClick={() => { removeField(field.id); setFieldMenuId(null); }}
                              className="w-full text-left px-4 py-2 text-[13px] text-red-600 hover:bg-red-50"
                            >
                              Remove field
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Forms section */}
            <div className="border border-gray-200 rounded-lg p-4 flex items-center justify-between">
              <div>
                <p className="text-[13.5px] font-semibold text-gray-800">Forms</p>
                <p className="text-[12.5px] text-gray-500 mt-0.5">Search the form template library to create a form to attach to this request type.</p>
              </div>
              <button className="px-3 py-1.5 border border-gray-300 rounded text-[13px] text-gray-700 hover:bg-gray-50">
                Attach form
              </button>
            </div>

            {/* Bottom action bar */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
              <button className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded text-[13px] text-gray-700 hover:bg-gray-50">
                <Eye size={13} /> View in Portal <ExternalLink size={11} />
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setDirty(false); }}
                  className="px-4 py-1.5 text-[13px] text-gray-600 hover:text-gray-800 rounded hover:bg-gray-100"
                >
                  Discard
                </button>
                <button
                  onClick={handleSave}
                  disabled={!dirty}
                  className={`px-4 py-1.5 text-[13px] font-medium rounded transition-colors ${
                    dirty
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {saved ? '✓ Saved' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>

          {/* ── Right sidebar: Fields panel ── */}
          <div className="w-72 border-l border-gray-200 flex-shrink-0 bg-white">
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-1.5 mb-3">
                <p className="text-[14px] font-semibold text-gray-900">Fields</p>
                <Info size={13} className="text-gray-400" />
              </div>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={fieldSearch}
                  onChange={e => setFieldSearch(e.target.value)}
                  placeholder="Type to search all fields"
                  className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-[13px] focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <p className="text-[11.5px] text-gray-400 mt-1.5">Use fields from any space on your site</p>
            </div>

            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
              {Object.entries(grouped).map(([group, names]) => (
                <div key={group}>
                  <p className="px-5 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                    {group}
                  </p>
                  {names.map(name => {
                    const alreadyAdded = fields.some(f => f.name === name);
                    return (
                      <div key={name} className="flex items-center justify-between px-5 py-2.5 hover:bg-blue-50 group border-b border-gray-50">
                        <div className="flex items-center gap-2">
                          <AlignLeft size={13} className="text-gray-400 flex-shrink-0" />
                          <span className="text-[12.5px] text-gray-700">{name}</span>
                        </div>
                        {alreadyAdded ? (
                          <span className="text-[11px] text-green-600 font-semibold">Added</span>
                        ) : (
                          <button
                            onClick={() => addField(name)}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-blue-100 text-blue-600 transition-opacity"
                          >
                            <Plus size={13} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              <div className="px-5 py-3 border-t border-gray-200 mt-2">
                <button className="text-[12.5px] text-blue-600 hover:underline flex items-center gap-1">
                  Create new custom fields <ExternalLink size={11} />
                </button>
                <p className="text-[11px] text-gray-400 mt-1">Refresh this page after creating new fields</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Work item view ── */}
      {activeTab === 'view' && (
        <div className="px-8 py-6 max-w-3xl">
          <p className="text-[13px] text-gray-600 mb-5">
            Configure which fields agents see when viewing a work item created from this request type.
          </p>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            {[
              { name: 'Summary',     hint: 'Subject line from email',       required: true  },
              { name: 'Status',      hint: 'Current workflow status',        required: true  },
              { name: 'Priority',    hint: 'Issue priority',                 required: false },
              { name: 'Assignee',    hint: 'Assigned agent',                 required: false },
              { name: 'Reporter',    hint: 'Customer email (from address)',   required: true  },
              { name: 'Description', hint: 'Email body',                     required: false },
              { name: 'Labels',      hint: 'Optional labels',                required: false },
              { name: 'Created',     hint: 'When ticket was created',        required: true  },
            ].map((f, i) => (
              <div key={f.name} className="flex items-center justify-between px-5 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <GripVertical size={13} className="text-gray-300 cursor-grab" />
                  <Type size={13} className="text-gray-400" />
                  <span className="text-[13.5px] text-gray-800 font-medium">{f.name}</span>
                  <span className="text-[12px] text-gray-400">{f.hint}</span>
                </div>
                {f.required && (
                  <span className="text-[11px] font-bold text-gray-600 border border-gray-300 px-1.5 py-0.5 rounded uppercase tracking-wide">
                    Required
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tab: Workflow statuses ── */}
      {activeTab === 'statuses' && (
        <div className="px-8 py-6 max-w-2xl">
          <p className="text-[13px] text-gray-600 mb-5">
            These are the workflow statuses available for this request type. Manage the full workflow in{' '}
            <span className="text-blue-600 hover:underline cursor-pointer">Workflows</span>.
          </p>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="grid grid-cols-3 bg-gray-50 border-b border-gray-200 px-4 py-2">
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Status</span>
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Category</span>
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Portal label</span>
            </div>
            {WORKFLOW_STATUSES.map(s => (
              <div key={s.name} className="grid grid-cols-3 items-center px-4 py-3.5 border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-[13.5px] text-gray-800 font-medium">{s.name}</span>
                </div>
                <span className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide">{s.category}</span>
                <span className="text-[13px] text-gray-500">{s.name}</span>
              </div>
            ))}
          </div>
          <p className="text-[12.5px] text-gray-400 mt-4">
            To add or change statuses, edit the workflow linked to this request type.
          </p>
        </div>
      )}
    </div>
  );
}
