import React, { useState } from 'react';
import { X, Layers, Plus, Trash2, Edit2, Check, AlertCircle } from 'lucide-react';
import { SourceGroup } from '../../types';
import { useApp } from '../../context/AppContext';

interface GroupManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_COLORS = [
  '#3B82F6', // Blue
  '#8B5CF6', // Purple
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#6366F1', // Indigo
  '#EF4444', // Red
];

export const GroupManagerModal: React.FC<GroupManagerModalProps> = ({ isOpen, onClose }) => {
  const { sourceGroups, sources, createSourceGroup, updateSourceGroup, deleteSourceGroup, notify, canManage } =
    useApp();

  const [isAdding, setIsAdding] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  // New Group Inputs
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen || !canManage) return null;

  const handleStartAdd = () => {
    setIsAdding(true);
    setEditingGroupId(null);
    setName('');
    setDescription('');
    setColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
    setErrorMsg(null);
  };

  const handleStartEdit = (group: SourceGroup) => {
    setIsAdding(false);
    setEditingGroupId(group.id);
    setName(group.name);
    setDescription(group.description || '');
    setColor(group.color || PRESET_COLORS[0]);
    setErrorMsg(null);
  };

  const handleCancelForm = () => {
    setIsAdding(false);
    setEditingGroupId(null);
    setName('');
    setDescription('');
    setErrorMsg(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setErrorMsg('Group name is required');
      return;
    }

    try {
      if (isAdding) {
        await createSourceGroup({
          name: trimmed,
          description: description.trim(),
          color,
          isSystem: false,
        });
      } else if (editingGroupId) {
        await updateSourceGroup(editingGroupId, {
          name: trimmed,
          description: description.trim(),
          color,
        });
      }
      handleCancelForm();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save group';
      setErrorMsg(msg);
    }
  };

  const handleDelete = async (group: SourceGroup) => {
    const attachedCount = sources.filter((s) => s.sourceGroup === group.name).length;
    if (attachedCount > 0) {
      notify(
        'warning',
        'Cannot Delete Group',
        `There are ${attachedCount} active source(s) assigned to "${group.name}". Reassign them first.`
      );
      return;
    }

    try {
      await deleteSourceGroup(group.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not delete group';
      notify('error', 'Delete Failed', msg);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div 
        className="w-full max-w-xl bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-semibold text-slate-100">Manage Source Groups</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-md hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Subheader and Add Button */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              Organize monitoring sources into distinct market, thematic, or regional clusters.
            </p>
            {!isAdding && !editingGroupId && (
              <button
                onClick={handleStartAdd}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Group
              </button>
            )}
          </div>

          {/* Inline Create/Edit Form */}
          {(isAdding || editingGroupId) && (
            <form onSubmit={handleSave} className="p-4 rounded-lg bg-slate-950/70 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-indigo-300">
                  {isAdding ? 'Create New Group' : 'Edit Group'}
                </span>
                <button
                  type="button"
                  onClick={handleCancelForm}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-300 uppercase">Group Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Greek Tech Media or Wearables"
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-md text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-300 uppercase">Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short explanation of editorial focus"
                  className="w-full px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-md text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Color picker */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-300 uppercase">Tag Color</label>
                <div className="flex items-center gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition ${
                        color === c ? 'border-white scale-110' : 'border-transparent opacity-80 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {errorMsg && (
                <div className="p-2 rounded bg-rose-950/50 border border-rose-800 text-xs text-rose-300 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {errorMsg}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCancelForm}
                  className="px-3 py-1 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 px-4 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded"
                >
                  <Check className="w-3.5 h-3.5" />
                  Save Group
                </button>
              </div>
            </form>
          )}

          {/* Group List */}
          <div className="divide-y divide-slate-800/80 border border-slate-800 rounded-lg overflow-hidden bg-slate-950/30">
            {sourceGroups.map((group) => {
              const assignedSources = sources.filter((s) => s.sourceGroup === group.name);
              return (
                <div
                  key={group.id}
                  className="p-3.5 flex items-center justify-between hover:bg-slate-800/30 transition"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="w-3 h-3 rounded-full mt-1 shrink-0"
                      style={{ backgroundColor: group.color || '#6366F1' }}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-slate-200">{group.name}</h4>
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                          {assignedSources.length} {assignedSources.length === 1 ? 'source' : 'sources'}
                        </span>
                      </div>
                      {group.description && (
                        <p className="text-xs text-slate-400 mt-0.5">{group.description}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleStartEdit(group)}
                      className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition"
                      title="Edit group"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(group)}
                      className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 rounded transition"
                      title="Delete group"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/40 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
