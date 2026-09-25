import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** collapsible: 顶栏/工具条用，平时只露图标，hover 展开；expanded: 常显输入框，用于弹窗/面板/页面 */
  mode?: 'collapsible' | 'expanded';
  className?: string;
  disabled?: boolean;
}

export function SearchInput({
  value,
  onChange,
  placeholder = '搜索…',
  mode = 'collapsible',
  className,
  disabled = false,
}: SearchInputProps) {
  const [expanded, setExpanded] = useState(mode === 'expanded');
  const inputRef = useRef<HTMLInputElement>(null);

  // expanded 模式强制展开
  useEffect(() => {
    if (mode === 'expanded') setExpanded(true);
  }, [mode]);

  // collapsible 模式：有内容时保持展开
  useEffect(() => {
    if (mode === 'collapsible' && value) setExpanded(true);
  }, [value, mode]);

  const handleMouseEnter = () => {
    if (mode !== 'collapsible' || disabled) return;
    setExpanded(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const handleBlur = () => {
    if (mode !== 'collapsible') return;
    setTimeout(() => {
      if (!value) setExpanded(false);
    }, 150);
  };

  const handleClear = () => {
    onChange('');
    inputRef.current?.focus();
  };

  if (mode === 'expanded') {
    return (
      <div
        className={cn(
          'relative flex items-center rounded-lg bg-input transition-shadow focus-within:ring-1 focus-within:ring-accent',
          disabled && 'opacity-50',
          className,
        )}
      >
        <Search className="absolute left-3 size-4 shrink-0 text-text-muted" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full bg-transparent py-2 pl-9 pr-8 text-[14px] text-text outline-none placeholder:text-text-muted disabled:cursor-not-allowed"
        />
        {value && !disabled && (
          <button
            onClick={handleClear}
            className="absolute right-2 flex size-5 items-center justify-center rounded text-text-muted hover:text-text"
            tabIndex={-1}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    );
  }

  // collapsible 模式
  return (
    <div
      onMouseEnter={handleMouseEnter}
      className={cn(
        'flex h-[30px] items-center overflow-hidden rounded-lg bg-input transition-all duration-200 ease-out',
        expanded ? 'w-[200px]' : 'w-[30px]',
        'focus-within:ring-1 focus-within:ring-accent',
        disabled && 'opacity-50',
        className,
      )}
    >
      <button
        type="button"
        disabled={disabled}
        className="flex size-[30px] shrink-0 items-center justify-center text-text-secondary"
        tabIndex={-1}
      >
        <Search className="size-[14px]" />
      </button>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        className="min-w-0 flex-1 bg-transparent pr-2 text-[13px] text-text outline-none placeholder:text-text-muted disabled:cursor-not-allowed"
      />
      {value && !disabled && (
        <button
          onClick={handleClear}
          className="mr-1 flex size-4 shrink-0 items-center justify-center text-text-muted hover:text-text"
          tabIndex={-1}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
