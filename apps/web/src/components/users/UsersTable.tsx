import type { ManagedUser } from '@hexpayroll/shared';
import { StatusIndicator } from '../system/StatusIndicator';
export function UsersTable({
  users,
  emptyMessage = 'No users found.',
  onEdit,
}: {
  users: ManagedUser[];
  emptyMessage?: string;
  onEdit?: (user: ManagedUser) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <caption className="sr-only">Payroll user accounts</caption>
        <thead>
          <tr>
            {['Name', 'Username', 'Role', 'Status', 'Last Login', 'Actions'].map((label) => (
              <th scope="col" key={label}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.length ? (
            users.map((user) => (
              <tr key={user.id}>
                <td>{user.displayName}</td>
                <td>{user.username}</td>
                <td>{user.roles.join(', ')}</td>
                <td>
                  <StatusIndicator tone={user.active ? 'healthy' : 'offline'}>
                    {user.active ? 'Active' : 'Inactive'}
                  </StatusIndicator>
                </td>
                <td>
                  {user.lastLoginAt
                    ? new Intl.DateTimeFormat('en-PH', {
                        timeZone: 'Asia/Manila',
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(user.lastLoginAt))
                    : '—'}
                </td>
                <td>
                  {onEdit ? (
                    <button className="text-action" onClick={() => onEdit(user)}>
                      Edit
                    </button>
                  ) : (
                    <span className="text-xs text-slate-500">Read only</span>
                  )}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6} className="text-center">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
