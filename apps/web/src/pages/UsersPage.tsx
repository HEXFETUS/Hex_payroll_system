import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { readUsers } from '../api/operations';
import { DataState } from '../components/DataState';
import { CreateUserForm } from '../components/users/CreateUserForm';
import { UsersTable } from '../components/users/UsersTable';
export function UsersPage() {
  const [open, setOpen] = useState(false);
  const users = useQuery({
    queryKey: ['operations', 'users'],
    queryFn: readUsers,
    networkMode: 'always',
  });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/settings" className="text-action text-sm">
          ← Settings
        </Link>
        <button className="primary-button" onClick={() => setOpen(true)}>
          Create User
        </button>
      </div>
      <p className="text-sm text-slate-600">
        User Management preview. Application roles and account administration are not implemented.
      </p>
      <section className="panel overflow-hidden">
        <DataState
          pending={users.isPending}
          error={users.isError}
          result={users.data}
          retry={() => void users.refetch()}
        >
          {(records) => <UsersTable users={records} />}
        </DataState>
        {!users.isError && users.data?.kind === 'unavailable' && (
          <UsersTable users={[]} emptyMessage="User records unavailable — integration pending." />
        )}
      </section>
      {open && <CreateUserForm onClose={() => setOpen(false)} />}
    </div>
  );
}
