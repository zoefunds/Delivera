const COLORS: Record<string, string> = {
  DRAFT: "bg-surface-container-high text-on-surface-variant",
  FUNDED: "bg-secondary-container text-on-secondary-container",
  ACTIVE: "bg-primary-fixed text-on-primary-fixed-variant",
  COMPLETED: "bg-success-emerald/15 text-success-emerald",
  CANCELLED: "bg-surface-container-high text-on-surface-variant",
  DISPUTED: "bg-error-container text-on-error-container",
  PENDING: "bg-surface-container-high text-on-surface-variant",
  SUBMITTED: "bg-tertiary-fixed text-on-tertiary-fixed-variant",
  APPROVED: "bg-success-emerald/15 text-success-emerald",
  NEEDS_REVISION: "bg-tertiary-fixed text-on-tertiary-fixed-variant",
  REJECTED: "bg-error-container text-on-error-container",
  EXHAUSTED: "bg-surface-container-high text-on-surface-variant",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${COLORS[status] ?? COLORS.PENDING}`}>{status.replace(/_/g, " ")}</span>
  );
}
