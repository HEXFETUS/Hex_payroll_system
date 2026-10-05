import type { Pool } from 'pg';
import { transaction } from '../foundation/repository.js';
import { enqueue, nextDate, processAttendance, type ProcessingActor } from './services.js';
// Row locks are held through processing; a crash rolls back both the result and cursor.
export async function processNextJob(pool: Pool): Promise<boolean> {
  return transaction(pool, async (c) => {
    const r = await c.query<{
      id: string;
      organization_id: string;
      employee_id: string;
      next_date: string;
      end_date: string;
      requested_by: string | null;
    }>(
      'SELECT * FROM attendance_processing_jobs WHERE last_error IS NULL ORDER BY priority DESC,COALESCE(last_processed_at,created_at),id FOR UPDATE SKIP LOCKED LIMIT 1',
    );
    const job = r.rows[0];
    if (!job) return false;
    const actor: ProcessingActor = {
      id: job.requested_by,
      organizationId: job.organization_id,
      permissions: [],
      roles: [],
    };
    await c.query('SAVEPOINT attendance_day');
    try {
      await processAttendance(c, actor, job.employee_id, job.next_date);
      if (job.next_date >= job.end_date)
        await c.query('DELETE FROM attendance_processing_jobs WHERE id=$1', [job.id]);
      else
        await c.query(
          'UPDATE attendance_processing_jobs SET next_date=$2,last_processed_at=now() WHERE id=$1',
          [job.id, nextDate(job.next_date)],
        );
    } catch {
      await c.query('ROLLBACK TO SAVEPOINT attendance_day');
      await c.query(
        "UPDATE attendance_processing_jobs SET last_error='Processing failed; retry required' WHERE id=$1",
        [job.id],
      );
    }
    return true;
  });
}
export async function scheduleDueAttendance(pool: Pool) {
  await transaction(pool, async (c) => {
    const orgs = await c.query<{ id: string; date: string }>(
      "SELECT id,(now() AT TIME ZONE timezone)::date::text date FROM organizations WHERE status='active' ORDER BY id",
    );
    for (const org of orgs.rows) {
      await c.query(
        'INSERT INTO attendance_processing_cursors(organization_id,next_date) SELECT $1,COALESCE(min(effective_from),$2::date) FROM employee_schedule_assignments WHERE organization_id=$1 ON CONFLICT DO NOTHING',
        [org.id, org.date],
      );
      const cursor = await c.query<{ next_date: string }>(
        'SELECT next_date FROM attendance_processing_cursors WHERE organization_id=$1 FOR UPDATE',
        [org.id],
      );
      const date = cursor.rows[0]!.next_date;
      const actor: ProcessingActor = {
        id: null,
        organizationId: org.id,
        permissions: [],
        roles: [],
      };
      // Recover a bounded historical batch, then revisit today/yesterday for shift closure.
      const recovered: string[] = [];
      let cursorDate = date;
      for (let i = 0; i < 7 && cursorDate < org.date; i++) {
        recovered.push(cursorDate);
        cursorDate = nextDate(cursorDate);
      }
      const dates = [...new Set([...recovered, nextDate(org.date, -1), org.date])];
      for (const d of dates) {
        const employees = await c.query<{ id: string }>(
          `SELECT e.id FROM employees e WHERE e.organization_id=$1 AND e.status IN ('active','on_leave') AND e.created_at<(($2::date+2)::timestamp AT TIME ZONE (SELECT timezone FROM organizations WHERE id=$1)) AND NOT EXISTS(SELECT 1 FROM attendance_processing_jobs j WHERE j.employee_id=e.id AND j.next_date<=$2 AND j.end_date>=$2) ORDER BY e.id`,
          [org.id, d],
        );
        for (const e of employees.rows) await enqueue(c, actor, e.id, d, d, false);
      }
      if (date < org.date)
        await c.query(
          'UPDATE attendance_processing_cursors SET next_date=$2 WHERE organization_id=$1',
          [org.id, cursorDate],
        );
    }
  });
}
export function startAttendanceWorker(pool: Pool, onError: (error: unknown) => void) {
  let stopped = false,
    running: Promise<void> | null = null;
  let lastScheduled = 0;
  const tick = () => {
    if (stopped || running) return;
    running = (async () => {
      try {
        if (Date.now() - lastScheduled >= 60000) {
          await scheduleDueAttendance(pool);
          lastScheduled = Date.now();
        }
        for (let i = 0; i < 50 && !stopped; i++) if (!(await processNextJob(pool))) break;
      } catch (e) {
        onError(e);
      }
    })().finally(() => {
      running = null;
    });
  };
  const timer = setInterval(tick, 2000);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
