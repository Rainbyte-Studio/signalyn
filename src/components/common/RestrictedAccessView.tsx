import React from 'react';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { Button } from './DesignSystem';

interface RestrictedAccessViewProps {
  title?: string;
  description?: string;
  onReturn: () => void;
}

export const RestrictedAccessView: React.FC<RestrictedAccessViewProps> = ({
  title = 'Administrator Access Required',
  description = 'This administrative screen and its associated workflows are restricted to verified administrators. Guest sessions are strictly read-only.',
  onReturn,
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-8 md:p-12 text-center rounded-xl bg-slate-900 border border-slate-800 max-w-xl mx-auto my-12 space-y-4">
      <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
        <ShieldAlert className="w-8 h-8" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-bold text-slate-100">{title}</h2>
        <p className="text-xs text-slate-400 leading-relaxed max-w-md">{description}</p>
      </div>
      <div className="pt-3">
        <Button
          variant="primary"
          size="md"
          onClick={onReturn}
          leftIcon={<ArrowLeft className="w-3.5 h-3.5" />}
        >
          Return to Overview Dashboard
        </Button>
      </div>
    </div>
  );
};
