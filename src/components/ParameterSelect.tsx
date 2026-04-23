import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

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

export function ParameterSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: ParameterSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label || '请选择';

  const open = useCallback(() => {
    if (disabled) return;
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPanelPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
    setIsOpen(true);
  }, [disabled]);

  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      // Guard: if mousedown fires on the trigger (before click), don't close
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      setIsOpen(false);
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  const handleSelect = (optValue: string) => {
    onChange(optValue);
    setIsOpen(false);
  };

  const COLS = label === '道具' ? 2 : 1;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); open(); }}
        disabled={disabled}
        className="
          w-full flex items-center justify-between bg-bg-elevated border border-border rounded-lg
          px-4 py-3 text-sm text-text-primary text-left
          focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30
          transition-colors cursor-pointer disabled:cursor-not-allowed
        "
      >
        <span className={value ? '' : 'text-text-secondary'}>{selectedLabel}</span>
        <ChevronDown
          size={16}
          className={`text-text-secondary transition-transform flex-shrink-0 ml-2 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: 'absolute',
              top: panelPos.top,
              left: panelPos.left,
              width: panelPos.width,
              zIndex: 9999,
            }}
            className="bg-bg-elevated border border-border rounded-xl shadow-2xl p-4"
          >
            <div
              className="overflow-y-auto"
              style={{ maxHeight: '320px' }}
            >
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}
              >
                {options.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    onMouseDown={(e) => e.preventDefault()}
                    className={`
                      flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left
                      transition-colors focus:outline-none
                      ${opt.value === value
                        ? 'bg-primary/20 text-primary border border-primary/40'
                        : 'text-text-primary hover:bg-black/5 border border-transparent'
                      }
                    `}
                  >
                    <span className={`
                      flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors
                      ${opt.value === value ? 'bg-primary border-primary' : 'border-text-secondary'}
                    `}>
                      {opt.value === value && <Check size={11} className="text-white" />}
                    </span>
                    <span className="truncate">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

interface ParameterMultiSelectProps {
  label: string;
  values: string[];
  options: SelectOption[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
}

export function ParameterMultiSelect({
  label,
  values,
  options,
  onChange,
  disabled = false,
}: ParameterMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selectedLabel =
    values.length === 0
      ? '请选择'
      : values.length === 1
      ? options.find((o) => o.value === values[0])?.label || '已选'
      : `已选 ${values.length} 个`;

  const open = useCallback(() => {
    if (disabled) return;
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPanelPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
    setIsOpen(true);
  }, [disabled]);

  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      // Guard: if mousedown fires on the trigger (before click), don't close
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      setIsOpen(false);
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  const toggleOption = (optValue: string) => {
    if (values.includes(optValue)) {
      onChange(values.filter((v) => v !== optValue));
    } else {
      onChange([...values, optValue]);
    }
  };

  const handleClear = useCallback(() => {
    onChange([]);
    setIsOpen(false);
  }, [onChange]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); open(); }}
        disabled={disabled}
        className="
          w-full flex items-center justify-between bg-bg-elevated border border-border rounded-lg
          px-4 py-3 text-sm text-text-primary text-left
          focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30
          transition-colors cursor-pointer disabled:cursor-not-allowed
        "
      >
        <span className={values.length ? '' : 'text-text-secondary'}>{selectedLabel}</span>
        <div className="flex items-center gap-1">
          {values.length > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleClear(); }}
              className="text-text-secondary hover:text-red-400 transition-colors leading-none"
              tabIndex={-1}
            >
              ×
            </button>
          )}
          <ChevronDown
            size={16}
            className={`text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: 'absolute',
              top: panelPos.top,
              left: panelPos.left,
              width: panelPos.width,
              zIndex: 9999,
            }}
            className="bg-bg-elevated border border-border rounded-xl shadow-2xl p-4"
          >
            <div
              className="overflow-y-auto"
              style={{ maxHeight: '320px' }}
            >
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}
              >
                {options.map((opt) => {
                  const checked = values.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleOption(opt.value)}
                      onMouseDown={(e) => e.preventDefault()}
                      className={`
                        flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left
                        transition-colors focus:outline-none
                        ${checked
                          ? 'bg-primary/20 text-primary border border-primary/40'
                          : 'text-text-primary hover:bg-black/5 border border-transparent'
                        }
                      `}
                    >
                      <span className={`
                        flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors
                        ${checked ? 'bg-primary border-primary' : 'border-text-secondary'}
                      `}>
                        {checked && <Check size={11} className="text-white" />}
                      </span>
                      <span className="truncate">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
