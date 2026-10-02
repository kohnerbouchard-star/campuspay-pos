import { z } from 'zod'
export const ReadinessDatabaseSchema = z.object({
  schema_version: z.string(), database_name: z.string(), funding_required: z.boolean(),
  database_flags: z.object({ refunds: z.boolean(), returns: z.boolean(), cash: z.boolean(), administration: z.boolean(), partialPreview: z.boolean(), partialRefunds: z.boolean(), funding: z.boolean() }),
})
export const CAPABILITIES = [
  { key: 'refunds', label: 'Full refunds', environmentKey: 'REFUNDS_ENABLED', dependencies: [] },
  { key: 'returns', label: 'Returns', environmentKey: 'RETURNS_ENABLED', dependencies: ['refunds'] },
  { key: 'cash', label: 'Cash shifts', environmentKey: 'CASH_CONTROLS_ENABLED', dependencies: [] },
  { key: 'administration', label: 'Staff and terminal changes', environmentKey: 'ADMINISTRATION_ENABLED', dependencies: [] },
  { key: 'partialPreview', label: 'Partial-refund calculator', environmentKey: 'PARTIAL_REFUND_PREVIEW_ENABLED', dependencies: [] },
  { key: 'partialRefunds', label: 'Partial-refund posting', environmentKey: 'PARTIAL_REFUNDS_ENABLED', dependencies: ['refunds'] },
  { key: 'funding', label: 'Wallet funding and cash movements', environmentKey: 'FUNDING_ENABLED', dependencies: [] },
] as const
export function capabilityStatus(application: boolean, database: boolean, dependencies: boolean): string {
  if (!application && !database) return 'Disabled in application and database'
  if (!application) return 'Disabled in application'
  if (!database) return 'Disabled in database'
  if (!dependencies) return 'Required dependency is disabled'
  return 'Enabled — operation-specific checks still apply'
}
