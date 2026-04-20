import React from 'react';

interface ParameterSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  unit?: string;
}

export function ParameterSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled = false,
  unit = '',
}: ParameterSliderProps) {
  return (
    <div className={`space-y-2 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-text-primary">{label}</label>
        <span className="text-sm text-primary font-medium tabular-nums">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="
          w-full h-1.5 rounded-full appearance-none cursor-pointer
          bg-bg-elevated
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-4
          [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-primary
          [&::-webkit-slider-thumb]:shadow-[0_2px_6px_rgba(0,113,227,0.35)]
          [&::-webkit-slider-thumb]:transition-transform
          [&::-webkit-slider-thumb]:hover:scale-110
          [&::-moz-range-thumb]:w-4
          [&::-moz-range-thumb]:h-4
          [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:bg-primary
          [&::-moz-range-thumb]:border-0
          [&::-moz-range-thumb]:shadow-[0_2px_6px_rgba(0,113,227,0.35)]
          disabled:[&::-webkit-slider-thumb]:cursor-not-allowed
          disabled:[&::-moz-range-thumb]:cursor-not-allowed
        "
      />
      <div className="flex justify-between text-xs text-text-tertiary">
        <span>
          {min}
          {unit}
        </span>
        <span>
          {max}
          {unit}
        </span>
      </div>
    </div>
  );
}
