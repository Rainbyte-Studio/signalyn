import React from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const ToastContainer: React.FC = () => {
  const { notifications, dismissNotification } = useApp();

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {notifications.map((notif) => {
        const getIcon = () => {
          switch (notif.type) {
            case 'success':
              return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
            case 'error':
              return <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />;
            case 'warning':
              return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
            default:
              return <Info className="w-4 h-4 text-indigo-400 shrink-0" />;
          }
        };

        const getBorderColor = () => {
          switch (notif.type) {
            case 'success':
              return 'border-emerald-500/40 bg-slate-900/95';
            case 'error':
              return 'border-rose-500/40 bg-slate-900/95';
            case 'warning':
              return 'border-amber-500/40 bg-slate-900/95';
            default:
              return 'border-indigo-500/40 bg-slate-900/95';
          }
        };

        return (
          <div
            key={notif.id}
            className={`pointer-events-auto p-3.5 rounded-xl border shadow-xl flex items-start gap-3 backdrop-blur-md animate-in slide-in-from-bottom-3 duration-200 ${getBorderColor()}`}
            role="alert"
          >
            {getIcon()}
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-semibold text-slate-100">{notif.title}</h4>
              {notif.message && (
                <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{notif.message}</p>
              )}
            </div>
            <button
              onClick={() => dismissNotification(notif.id)}
              className="text-slate-500 hover:text-slate-300 p-0.5 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
