import { Link } from 'react-router-dom';
import { usePermission } from './FoundationPages';
export const settingsNavigation = [
  {
    title: 'Payroll Monetary Policies',
    path: '/settings/payroll-policies',
    permission: 'payroll_config.view',
  },
  {
    title: 'Statutory Tables',
    path: '/settings/statutory-tables',
    permission: 'contributions.view',
  },
  { title: 'Organization', path: '/settings/organization', permission: 'organization.view' },
  { title: 'Users', path: '/settings/users', permission: 'users.view' },
  { title: 'Roles & Permissions', path: '/settings/roles', permission: 'roles.view' },
  { title: 'Departments', path: '/settings/departments', permission: 'departments.view' },
  { title: 'Positions', path: '/settings/positions', permission: 'positions.view' },
  {
    title: 'Payroll Configuration',
    path: '/settings/payroll-config',
    permission: 'payroll_config.view',
  },
  { title: 'Biometric Devices', path: '/settings/biometric-devices', permission: 'employees.view' },
  {
    title: 'Biometric Mappings',
    path: '/settings/biometric-mappings',
    permission: 'employees.view',
  },
  { title: 'System', path: '/settings/system', permission: 'system_health.view' },
  { title: 'Audit Trail', path: '/settings/audit', permission: 'audit.view' },
];
function SettingsLink({ item }: { item: (typeof settingsNavigation)[number] }) {
  const allowed = usePermission(item.permission);
  const taxAllowed = usePermission('tax.view');
  return allowed || (item.path === '/settings/statutory-tables' && taxAllowed) ? (
    <Link className="panel p-5 text-action" to={item.path}>
      {item.title} →
    </Link>
  ) : null;
}
export function SettingsPage() {
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600">
        Company administration and local workstation configuration.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {settingsNavigation.map((item) => (
          <SettingsLink key={item.path} item={item} />
        ))}
      </div>
    </div>
  );
}
