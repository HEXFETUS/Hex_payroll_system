import { useState, type ComponentProps } from 'react';
export function PasswordInput(props: Omit<ComponentProps<'input'>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visible ? 'text' : 'password'} className="credential-input pr-12" />
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md text-slate-500 hover:text-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50"
        onClick={() => setVisible(!visible)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-controls={props.id}
        aria-pressed={visible}
        disabled={props.disabled}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="m3 3 18 18" />}
        </svg>
      </button>
    </div>
  );
}
