/** An unresolved operation must be recovered, never treated as a discardable draft. */
export type LeaveState = 'clean' | 'dirty' | 'pending'
