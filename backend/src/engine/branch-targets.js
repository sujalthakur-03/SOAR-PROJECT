/**
 * ══════════════════════════════════════════════════════════════════════════════
 * BRANCH TARGETS — normalization helper for fan-out DSL
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Every branch field in a playbook step (on_success, on_true, on_false,
 * on_approved, on_rejected, on_timeout, on_complete) MAY be either:
 *   - a single string (legacy single-target playbooks)
 *   - an array of strings (new fan-out playbooks)
 *   - undefined / null / empty
 *
 * normalizeBranchTargets() coerces any of those to a plain string[]. Callers
 * iterate over the result for both single-target and fan-out cases without
 * having to branch on shape.
 *
 * Decision date: 2026-06. Wire format chosen "always array" for new saves;
 * legacy data on disk stays string-shaped and is normalized at read time.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Coerce a branch field to a non-empty array of strings.
 *
 * @param {string|string[]|null|undefined} value - The DSL branch field value.
 * @returns {string[]} Always an array; never null/undefined.
 */
export function normalizeBranchTargets(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === 'string' && v.length > 0);
  }
  if (typeof value === 'string') return [value];
  return [];
}

export default { normalizeBranchTargets };
