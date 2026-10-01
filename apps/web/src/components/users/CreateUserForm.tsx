import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { createUserSchema } from '@hexpayroll/shared';
import { PasswordInput } from '../auth/PasswordInput';

export function CreateUserForm({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [fields, setFields] = useState({
    displayName: '',
    username: '',
    password: '',
    confirmation: '',
    status: 'active',
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const parsed = createUserSchema.safeParse({
    displayName: fields.displayName,
    username: fields.username,
    password: fields.password,
  });
  const errors: Record<string, string> = {};
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      errors[key] =
        key === 'username'
          ? 'Use 3–64 letters, numbers, dots, underscores, or hyphens.'
          : key === 'password'
            ? 'Use 15–128 characters.'
            : 'Enter a full name of at most 128 characters.';
    }
  if (fields.confirmation !== fields.password || !fields.confirmation)
    errors.confirmation = 'Passwords must match.';
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  function close() {
    setFields({ displayName: '', username: '', password: '', confirmation: '', status: 'active' });
    onClose();
  }
  const props = (key: 'displayName' | 'username' | 'password' | 'confirmation') => ({
    id: `${id}-${key}`,
    name: key,
    value: fields[key],
    required: true,
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      setFields((current) => ({ ...current, [key]: event.target.value })),
    onBlur: () => setTouched((current) => ({ ...current, [key]: true })),
    'aria-invalid': Boolean(touched[key] && errors[key]),
    'aria-describedby': touched[key] && errors[key] ? `${id}-${key}-error` : undefined,
  });
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
          ),
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id={`${id}-title`} className="text-xl font-semibold">
          Create User
        </h2>
        <button type="button" className="secondary-button" onClick={close}>
          Close
        </button>
      </div>
      <p id={`${id}-description`} className="notice mb-5">
        Interface preview only. Account creation is unavailable until backend APIs and authorization
        are implemented.
      </p>
      <form noValidate onSubmit={(event) => event.preventDefault()} className="space-y-4">
        {(['displayName', 'username', 'password', 'confirmation'] as const).map((key) => (
          <div key={key}>
            <label className="field-label mb-2 block" htmlFor={`${id}-${key}`}>
              {
                {
                  displayName: 'Full Name',
                  username: 'Username',
                  password: 'Password',
                  confirmation: 'Confirm Password',
                }[key]
              }
            </label>
            {key === 'password' || key === 'confirmation' ? (
              <PasswordInput {...props(key)} autoComplete="new-password" />
            ) : (
              <input
                {...props(key)}
                className="credential-input"
                maxLength={key === 'username' ? 64 : 128}
                autoComplete={key === 'username' ? 'off' : 'name'}
              />
            )}
            {touched[key] && errors[key] && (
              <p id={`${id}-${key}-error`} className="mt-2 text-xs text-red-700">
                {errors[key]}
              </p>
            )}
          </div>
        ))}
        <div>
          <label className="field-label block" htmlFor={`${id}-role`}>
            Role
          </label>
          <select
            id={`${id}-role`}
            className="credential-input mt-2"
            disabled
            aria-describedby={`${id}-role-help`}
          >
            <option>Authorization roles not defined</option>
          </select>
        </div>
        <p id={`${id}-role-help`} className="text-xs text-slate-500">
          Role selection will be enabled when the backend authorization model exists.
        </p>
        <div>
          <label className="field-label block" htmlFor={`${id}-status`}>
            Status (draft only)
          </label>
          <select
            id={`${id}-status`}
            className="credential-input mt-2"
            value={fields.status}
            onChange={(event) => setFields({ ...fields, status: event.target.value })}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <p id={`${id}-submit-help`} className="text-xs text-slate-500">
          No account or password will be saved. Close this dialog to discard the draft.
        </p>
        <div className="flex justify-end gap-3">
          <button type="button" className="secondary-button" onClick={close}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled
            aria-describedby={`${id}-submit-help`}
          >
            Create User unavailable
          </button>
        </div>
      </form>
    </dialog>
  );
}
