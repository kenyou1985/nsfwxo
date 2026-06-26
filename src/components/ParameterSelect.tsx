import React, { useState } from 'react';

interface SelectOption {
  value: string;
  label: string;
}

interface ParameterSelectProps {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * Direct copy of PosePresetSelector's collapsible panel pattern.
 * - Header uses plain div + onClick (not <button>)
 * - Panel renders inline below header (no portal, no fixed positioning)
 * - Options are plain <button onClick> inside the same React tree
 */
export function ParameterSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: ParameterSelectProps) {
  const [expanded, setExpanded] = useState(false);

  const handleToggleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    setExpanded((v) => !v);
  };

  const handleSelect = (optValue: string) => {
    if (disabled) return;
    onChange(optValue);
    setExpanded(false);
  };

  const selectedOption = options.find((o) => o.value === value);
  const displayText = selectedOption?.label || '请选择';

  return (
    <div className="border border-border rounded-xl bg-white overflow-hidden">
      <div
        onClick={handleToggleClick}
        className="w-full px-4 py-3 flex items-center justify-between bg-bg-elevated hover:bg-bg-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-text-tertiary">{label}</span>
          <span className={`text-sm font-medium truncate ${value ? 'text-text-primary' : 'text-text-secondary'}`}>
            {displayText}
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-text-tertiary transition-transform flex-shrink-0 ml-2 ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {expanded && (
        <div className="p-3 border-t border-border">
          <div
            className="grid grid-cols-1 gap-1.5 max-h-64 overflow-y-auto"
            style={{ scrollbarWidth: 'thin' }}
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelect(opt.value)}
                className={[
                  'flex items-center gap-2 text-left px-3 py-2 rounded-lg text-xs transition-colors',
                  opt.value === value
                    ? 'bg-primary text-white'
                    : 'bg-bg-elevated hover:bg-primary-light hover:text-primary text-text-primary',
                ].join(' ')}
              >
                <span className={`flex-shrink-0 w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                  opt.value === value ? 'border-white bg-white' : 'border-border'
                }`}>
                  {opt.value === value && (
                    <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  )}
                </span>
                <span className="truncate">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}