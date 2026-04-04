import type { Knex } from 'knex';

interface ApprovalRuleRow {
  rule_name: string;
  description: string;
  transaction_type: string | null;
  max_auto_approve_amount: number | null;
  require_manual_review: boolean;
  active: boolean;
  priority: number;
}

// Rules are evaluated in ascending priority order; the first matching rule wins.
//
// Matching logic (implemented in the posting engine):
//   1. If transaction_type is not null, the rule only matches that type.
//   2. If require_manual_review is true, route to the manual queue.
//   3. Otherwise, if total_amount <= max_auto_approve_amount (or max is null), auto-approve.
//   4. If total_amount > max_auto_approve_amount, route to the manual queue.
const rules: ApprovalRuleRow[] = [
  {
    // Manual journals always go to the queue — they are human-initiated and
    // must be reviewed before posting to the permanent ledger.
    rule_name: 'Manual journal — always review',
    description:
      'All manual journal entries require manual approval regardless of amount.',
    transaction_type: 'MANUAL_JOURNAL',
    max_auto_approve_amount: null,
    require_manual_review: true,
    active: true,
    priority: 10,
  },
  {
    // Prior period adjustments are sensitive and always need sign-off.
    rule_name: 'Prior period adjustment — always review',
    description:
      'All prior period adjustments require manual approval due to their impact on closed periods.',
    transaction_type: 'PRIOR_PERIOD_ADJUSTMENT',
    max_auto_approve_amount: null,
    require_manual_review: true,
    active: true,
    priority: 20,
  },
  {
    // Routine module-generated transactions under £10,000 are auto-approved.
    rule_name: 'Auto-approve routine transactions under £10,000',
    description:
      'Customer invoices, supplier invoices, and payments with a total value at or below ' +
      '£10,000 are automatically approved and posted immediately.',
    transaction_type: null,
    max_auto_approve_amount: 10000.0,
    require_manual_review: false,
    active: true,
    priority: 100,
  },
  {
    // Any transaction not matched by an earlier rule requires manual review.
    rule_name: 'Default — require manual review',
    description:
      'Catch-all rule: any transaction not auto-approved by a higher-priority rule ' +
      'is held for manual review.',
    transaction_type: null,
    max_auto_approve_amount: null,
    require_manual_review: true,
    active: true,
    priority: 999,
  },
];

export async function seed(knex: Knex): Promise<void> {
  // Truncate and re-insert so that re-running the seed is idempotent.
  // Approval rules are configuration data; we own the full set.
  await knex('approval_rules').del();
  await knex('approval_rules').insert(rules);
}
