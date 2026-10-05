CREATE TABLE payroll_policies (
 id uuid PRIMARY KEY DEFAULT uuidv7(),organization_id uuid NOT NULL REFERENCES organizations(id),version text NOT NULL,effective_from date NOT NULL,effective_to date CHECK(effective_to>effective_from),
 policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object'),created_by uuid NOT NULL REFERENCES auth_users(id),revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,id),UNIQUE(organization_id,version)
);
CREATE INDEX payroll_policy_effectivity_idx ON payroll_policies(organization_id,effective_from);
CREATE TABLE statutory_rule_sets (
 id uuid PRIMARY KEY DEFAULT uuidv7(),organization_id uuid NOT NULL REFERENCES organizations(id),type text NOT NULL CHECK(type IN ('sss','philhealth','pagibig','bir')),
 version text NOT NULL,effective_from date NOT NULL,effective_to date CHECK(effective_to>effective_from),status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active')),
 agency text NOT NULL,source_title text NOT NULL,source_reference text NOT NULL,verification_note text NOT NULL,content_checksum text NOT NULL,
 rules jsonb NOT NULL CHECK(jsonb_typeof(rules)='object'),imported_by uuid NOT NULL REFERENCES auth_users(id),verified_by uuid REFERENCES auth_users(id),verified_at timestamptz,
 revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,id),UNIQUE(organization_id,type,version)
);
CREATE INDEX statutory_effectivity_idx ON statutory_rule_sets(organization_id,type,effective_from) WHERE status='active';
CREATE TABLE payroll_contribution_lines (
 id uuid PRIMARY KEY DEFAULT uuidv7(),organization_id uuid NOT NULL REFERENCES organizations(id),result_id uuid NOT NULL,type text NOT NULL CHECK(type IN ('sss','philhealth','pagibig')),
 rule_set_id uuid NOT NULL,employee_share bigint NOT NULL CHECK(employee_share BETWEEN 0 AND 9007199254740991),employer_share bigint NOT NULL CHECK(employer_share BETWEEN 0 AND 9007199254740991),
 basis_amount bigint NOT NULL CHECK(basis_amount BETWEEN 0 AND 9007199254740991),tax_deductible boolean NOT NULL,metadata jsonb NOT NULL,revision integer NOT NULL DEFAULT 1,
 FOREIGN KEY(organization_id,result_id) REFERENCES employee_payroll_results(organization_id,id),FOREIGN KEY(organization_id,rule_set_id) REFERENCES statutory_rule_sets(organization_id,id),UNIQUE(result_id,type)
);
CREATE INDEX payroll_contributions_rule_idx ON payroll_contribution_lines(rule_set_id);
