CREATE TABLE payroll_periods (
 id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organizations(id), code text NOT NULL, name text NOT NULL,
 period_start date NOT NULL, period_end date NOT NULL CHECK(period_end>=period_start), pay_date date NOT NULL,
 pay_frequency text NOT NULL CHECK(pay_frequency IN ('monthly','semi_monthly','weekly','biweekly')),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','review','finalized','cancelled')),
 latest_run_id uuid, reviewed_run_id uuid, reviewed_by uuid REFERENCES auth_users(id), reviewed_at timestamptz,
 warning_acknowledgments jsonb NOT NULL DEFAULT '[]', finalized_by uuid REFERENCES auth_users(id), finalized_at timestamptz,
 correction_of_id uuid, revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_by uuid NOT NULL REFERENCES auth_users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id), UNIQUE(organization_id,code),
 FOREIGN KEY(organization_id,correction_of_id) REFERENCES payroll_periods(organization_id,id)
);
CREATE INDEX payroll_periods_list_idx ON payroll_periods(organization_id,period_start DESC,pay_frequency);
CREATE TABLE payroll_runs (
 id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organizations(id), period_id uuid NOT NULL,
 idempotency_key uuid NOT NULL, status text NOT NULL CHECK(status IN ('processing','computed','failed')),
 engine_version text NOT NULL, input_hash text NOT NULL, snapshot jsonb NOT NULL, totals jsonb NOT NULL DEFAULT '{}', issues jsonb NOT NULL DEFAULT '[]',
 prepared_by uuid NOT NULL REFERENCES auth_users(id), finalized boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id), UNIQUE(period_id,id), UNIQUE(period_id,idempotency_key),
 FOREIGN KEY(organization_id,period_id) REFERENCES payroll_periods(organization_id,id)
);
ALTER TABLE payroll_periods ADD FOREIGN KEY(id,latest_run_id) REFERENCES payroll_runs(period_id,id), ADD FOREIGN KEY(id,reviewed_run_id) REFERENCES payroll_runs(period_id,id);
CREATE TABLE employee_payroll_results (
 id uuid PRIMARY KEY DEFAULT uuidv7(), organization_id uuid NOT NULL REFERENCES organizations(id), payroll_run_id uuid NOT NULL, employee_id uuid NOT NULL,
 basic_pay bigint NOT NULL CHECK(basic_pay BETWEEN 0 AND 9007199254740991), gross_pay bigint NOT NULL CHECK(gross_pay BETWEEN 0 AND 9007199254740991),
 ordinary_deductions bigint NOT NULL CHECK(ordinary_deductions BETWEEN 0 AND 9007199254740991), employee_contributions bigint NOT NULL CHECK(employee_contributions BETWEEN 0 AND 9007199254740991),
 employer_contributions bigint NOT NULL CHECK(employer_contributions BETWEEN 0 AND 9007199254740991), withholding_tax bigint NOT NULL CHECK(withholding_tax BETWEEN 0 AND 9007199254740991),
 taxable_compensation bigint NOT NULL CHECK(taxable_compensation BETWEEN 0 AND 9007199254740991), total_deductions bigint NOT NULL CHECK(total_deductions BETWEEN 0 AND 9007199254740991),
 net_pay bigint NOT NULL CHECK(net_pay BETWEEN -9007199254740991 AND 9007199254740991),
 snapshot jsonb NOT NULL, tax_trace jsonb NOT NULL, issues jsonb NOT NULL, status text NOT NULL CHECK(status IN ('computed','failed','finalized')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(payroll_run_id,employee_id),
 FOREIGN KEY(organization_id,payroll_run_id) REFERENCES payroll_runs(organization_id,id), FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id),
 CHECK(total_deductions=ordinary_deductions+employee_contributions+withholding_tax), CHECK(net_pay=gross_pay-total_deductions)
);
CREATE INDEX employee_payroll_history_idx ON employee_payroll_results(organization_id,employee_id,payroll_run_id);
CREATE TABLE payroll_types (
 id uuid PRIMARY KEY DEFAULT uuidv7(),organization_id uuid NOT NULL REFERENCES organizations(id),kind text NOT NULL CHECK(kind IN ('earning','deduction')),
 code text NOT NULL,name text NOT NULL,taxable boolean NOT NULL,category text NOT NULL CHECK(category IN ('attendance','loan','company','other')),active boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,id),UNIQUE(organization_id,kind,code)
);
CREATE TABLE payroll_entries (
 id uuid PRIMARY KEY DEFAULT uuidv7(),organization_id uuid NOT NULL REFERENCES organizations(id),employee_id uuid NOT NULL,type_id uuid NOT NULL,
 amount bigint NOT NULL CHECK(amount BETWEEN 0 AND 9007199254740991),reason text NOT NULL CHECK(length(btrim(reason))>0),period_id uuid,start_date date,end_date date,
 active boolean NOT NULL DEFAULT true,created_by uuid NOT NULL REFERENCES auth_users(id),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),FOREIGN KEY(organization_id,employee_id) REFERENCES employees(organization_id,id),FOREIGN KEY(organization_id,type_id) REFERENCES payroll_types(organization_id,id),FOREIGN KEY(organization_id,period_id) REFERENCES payroll_periods(organization_id,id),
 CHECK((period_id IS NOT NULL AND start_date IS NULL AND end_date IS NULL) OR (period_id IS NULL AND start_date IS NOT NULL AND (end_date IS NULL OR end_date>=start_date)))
);
CREATE INDEX payroll_entries_lookup_idx ON payroll_entries(organization_id,employee_id,period_id,start_date) WHERE active;
CREATE TABLE payroll_earning_lines (
 id uuid PRIMARY KEY DEFAULT uuidv7(),organization_id uuid NOT NULL REFERENCES organizations(id),result_id uuid NOT NULL,code text NOT NULL,description text NOT NULL,
 amount bigint NOT NULL CHECK(amount BETWEEN 0 AND 9007199254740991),taxable boolean NOT NULL,metadata jsonb NOT NULL,revision integer NOT NULL DEFAULT 1,
 FOREIGN KEY(organization_id,result_id) REFERENCES employee_payroll_results(organization_id,id)
);
CREATE INDEX payroll_earning_result_idx ON payroll_earning_lines(result_id);
CREATE TABLE payroll_deduction_lines (LIKE payroll_earning_lines INCLUDING ALL);
ALTER TABLE payroll_deduction_lines ADD FOREIGN KEY(organization_id,result_id) REFERENCES employee_payroll_results(organization_id,id), ADD FOREIGN KEY(organization_id) REFERENCES organizations(id);
