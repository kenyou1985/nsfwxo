import React from 'react';

interface ParameterToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function ParameterToggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: ParameterToggleProps) {
  return (
    <div className={`flex items-start justify-between gap-4 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex-1 min-w-0">
        <label className="block text-sm font-medium text-slate-300">{label}</label>
        {description && (
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        className={`
          relative flex-shrink-0 w-11 h-6 rounded-full transition-colors
          focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface
          ${checked ? 'bg-primary' : 'bg-bg-elevated'}
          ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <span
          className={`
            absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md
            transition-transform
            ${checked ? 'translate-x-5' : 'translate-x-0'}
          `}
        />
      </button>
    </div>
  );
}
