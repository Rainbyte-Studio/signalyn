import React from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  itemName?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isProcessing?: boolean;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  title,
  message,
  itemName,
  onConfirm,
  onCancel,
  isProcessing = false,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div 
        className="w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/80">
          <div className="flex items-center gap-2.5 text-rose-400">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h3 className="font-semibold text-slate-100">{title}</h3>
          </div>
          <button
            onClick={onCancel}
            disabled={isProcessing}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-md hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-sm text-slate-300 leading-relaxed">{message}</p>
          {itemName && (
            <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 font-mono text-xs text-rose-300 font-medium truncate">
              {itemName}
            </div>
          )}
          <p className="text-xs text-slate-400">
            This destructive action removes the entity from the system. It will cease scheduled monitoring.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-3.5 border-t border-slate-800 bg-slate-950/40">
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isProcessing}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 rounded-lg shadow-sm transition disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {isProcessing ? 'Removing...' : 'Confirm Deletion'}
          </button>
        </div>
      </div>
    </div>
  );
};
