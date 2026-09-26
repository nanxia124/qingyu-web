import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement>;
}

export function PasswordInput({
  value,
  onChange,
  placeholder,
  error = false,
  autoFocus = false,
  disabled = false,
  inputRef,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div
      className={cn(
        'relative flex items-center rounded-lg bg-secondary transition-shadow',
        error ? 'ring-1 ring-red-500' : 'focus-within:ring-1 focus-within:ring-accent',
        disabled && 'opacity-50',
      )}
    >
      <input
        ref={inputRef}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        className="w-full bg-transparent px-3 py-2 text-white outline-none placeholder:text-gray-500 disabled:cursor-not-allowed"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        className="absolute right-2 flex h-7 w-7 items-center justify-center rounded text-gray-500 hover:text-gray-300"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
