import Decimal from 'decimal.js';
import type { Knex } from 'knex';
import type { ApprovalDecision, ApprovalRuleRow } from './types';

// ---------------------------------------------------------------------------
// approve.ts — approval rule evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluates active approval rules in ascending priority order.
 * The first rule that matches the submission determines the outcome.
 *
 * Matching logic (in order):
 *   1. Rule must be active.
 *   2. If rule.transaction_type is set, it must equal the submission's type.
 *   3. If rule.require_manual_review is true → PENDING_REVIEW, stop.
 *   4. If rule.max_auto_approve_amount is set AND totalAmount <= that limit
 *      → AUTO_APPROVED, stop.
 *   5. If rule.max_auto_approve_amount is null → AUTO_APPROVED (no limit), stop.
 *
 * If no rule matches, defaults to PENDING_REVIEW (safe default).
 */
export async function evaluateApprovalRules(
  trx: Knex | Knex.Transaction,
  transactionType: string,
  totalAmount: Decimal,
): Promise<ApprovalDecision> {
  const rules = await trx<ApprovalRuleRow>('approval_rules')
    .where('active', true)
    .orderBy('priority', 'asc')
    .select('id', 'rule_name', 'transaction_type', 'max_auto_approve_amount', 'require_manual_review', 'priority');

  for (const rule of rules) {
    // Does this rule apply to this transaction type?
    if (rule.transaction_type !== null && rule.transaction_type !== transactionType) {
      continue;
    }

    // Rule matches.
    if (rule.require_manual_review) {
      return { outcome: 'PENDING_REVIEW', rule_id: rule.id, rule_name: rule.rule_name };
    }

    // Auto-approve: check amount limit if present.
    if (rule.max_auto_approve_amount !== null) {
      const limit = new Decimal(rule.max_auto_approve_amount);
      if (totalAmount.lte(limit)) {
        return { outcome: 'AUTO_APPROVED', rule_id: rule.id, rule_name: rule.rule_name };
      }
      // Amount exceeds this rule's limit — fall through to the next rule.
      continue;
    }

    // No amount limit — auto-approve unconditionally.
    return { outcome: 'AUTO_APPROVED', rule_id: rule.id, rule_name: rule.rule_name };
  }

  // No rule matched — safe default: require manual review.
  return { outcome: 'PENDING_REVIEW', rule_id: null, rule_name: null };
}

/**
 * Computes the "total amount" used for rule evaluation.
 *
 * For line-based submissions (MANUAL_JOURNAL, PRIOR_PERIOD_ADJUSTMENT),
 * this is the sum of all debit amounts (= sum of credit amounts, since the
 * transaction balances).  Using the debit side avoids double-counting.
 *
 * For amount-based submissions, use the gross `amount` directly.
 */
export function computeTotalAmount(
  grossAmount: number | undefined,
  debitLines: Array<{ debit: number }>,
): Decimal {
  if (grossAmount !== undefined) {
    return new Decimal(grossAmount);
  }
  return debitLines.reduce((acc, line) => acc.plus(new Decimal(line.debit)), new Decimal(0));
}
