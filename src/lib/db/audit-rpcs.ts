export const AUDIT_RPCS = {
  recover_stock_adjustment: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_idempotency_key', cast: 'uuid' }],
  installation_readiness: [{ name: 'p_session_id', cast: 'uuid' }],
} as const
