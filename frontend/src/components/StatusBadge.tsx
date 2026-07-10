const COLORS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  FUNDED: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  ACTIVE: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  COMPLETED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  CANCELLED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  DISPUTED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  PENDING: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  SUBMITTED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  APPROVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  NEEDS_REVISION: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  EXHAUSTED: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${COLORS[status] ?? COLORS.PENDING}`}>{status.replace(/_/g, " ")}</span>
  );
}
