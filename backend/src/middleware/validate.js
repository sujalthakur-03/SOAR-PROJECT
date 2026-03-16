/**
 * Express middleware factory for request validation.
 * Uses simple schema validation (no external deps).
 */

const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const VALID_EXEC_STATES = ['EXECUTING', 'WAITING_APPROVAL', 'COMPLETED', 'FAILED'];
const VALID_CASE_STATUSES = ['OPEN', 'INVESTIGATING', 'PENDING', 'RESOLVED', 'CLOSED'];
const MAX_LIMIT = 500;
const MAX_OFFSET = 100000;

function validatePagination(req, res, next) {
  if (req.query.limit) {
    const limit = parseInt(req.query.limit);
    if (isNaN(limit) || limit < 1) return res.status(400).json({ error: 'limit must be a positive integer' });
    req.query.limit = String(Math.min(limit, MAX_LIMIT));
  }
  if (req.query.offset) {
    const offset = parseInt(req.query.offset);
    if (isNaN(offset) || offset < 0) return res.status(400).json({ error: 'offset must be non-negative' });
    req.query.offset = String(Math.min(offset, MAX_OFFSET));
  }
  next();
}

function validateSeverity(req, res, next) {
  const severity = req.query.severity || req.body?.severity;
  if (severity) {
    const values = typeof severity === 'string' ? severity.split(',') : (Array.isArray(severity) ? severity : [severity]);
    for (const v of values) {
      if (!VALID_SEVERITIES.includes(v.toLowerCase())) {
        return res.status(400).json({ error: `Invalid severity: ${v}. Must be one of: ${VALID_SEVERITIES.join(', ')}` });
      }
    }
  }
  next();
}

function validateExecutionState(req, res, next) {
  const state = req.query.state || req.body?.state;
  if (state) {
    const values = typeof state === 'string' ? state.split(',') : (Array.isArray(state) ? state : [state]);
    for (const v of values) {
      if (!VALID_EXEC_STATES.includes(v)) {
        return res.status(400).json({ error: `Invalid state: ${v}. Must be one of: ${VALID_EXEC_STATES.join(', ')}` });
      }
    }
  }
  next();
}

function validateCaseStatus(req, res, next) {
  const status = req.body?.status;
  if (status && !VALID_CASE_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status: ${status}. Must be one of: ${VALID_CASE_STATUSES.join(', ')}` });
  }
  next();
}

export {
  validatePagination,
  validateSeverity,
  validateExecutionState,
  validateCaseStatus,
  VALID_SEVERITIES,
  VALID_EXEC_STATES,
  VALID_CASE_STATUSES,
  MAX_LIMIT
};
