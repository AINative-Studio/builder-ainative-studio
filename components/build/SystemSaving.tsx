/**
 * SystemSaving (#dashboard-ux) — the per-card savings line for a business system.
 *
 * Communicates the value of an included AINative primitive by naming the
 * comparable stand-alone SaaS the founder would otherwise pay for, and that
 * provider's entry monthly price. Renders nothing when we don't have a credible
 * comparable to quote (we never invent a number). Data comes from
 * SAVINGS_BY_PRIMITIVE in lib/build/business-systems.ts.
 */
export function SystemSaving({
  vsProvider,
  savedMonthly,
}: {
  vsProvider?: string
  savedMonthly?: number
}) {
  if (!vsProvider || !savedMonthly || savedMonthly <= 0) return null
  return (
    <span className="m-system-saving m-mono" data-testid="system-saving">
      ${savedMonthly}/mo on {vsProvider} — included
    </span>
  )
}
