import { Link } from 'react-router-dom';
export function SettingsPage() {
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600">Administration and local workstation information.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="font-semibold">User Management</h2>
          <p className="my-3 text-sm leading-6 text-slate-600">
            Preview the account listing and create-user interface. Backend integration and
            authorization roles are pending.
          </p>
          <Link className="text-action text-sm" to="/settings/users">
            Open User Management →
          </Link>
        </section>
        {['System Configuration', 'Biometric Configuration'].map((title) => (
          <section className="panel p-5" key={title}>
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-3 text-sm text-slate-600">
              Configuration controls will be available in a future update.
            </p>
            <p className="mt-3 text-xs text-slate-500">Future functionality</p>
          </section>
        ))}
        <section className="panel p-5">
          <h2 className="font-semibold">Database / System Information</h2>
          <p className="my-3 text-sm text-slate-600">Review local API and database readiness.</p>
          <Link className="text-action text-sm" to="/system-health">
            View System Health →
          </Link>
        </section>
      </div>
    </div>
  );
}
