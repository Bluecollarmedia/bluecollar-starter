/**
 * Estimated project progress from its tasks. The same formula the database uses (update 121, _recompute_project_progress):
 * a completed task counts 1, an in-progress task counts half, divided by all tasks; never 100 (only completing the project sets 100).
 * No tasks: no estimate (null), so the number is left alone.
 */
export function estimateProgress(stats: { total: number; completed: number; inProgress: number }): number | null {
  if (stats.total <= 0) return null;
  return Math.min(99, Math.round((100 * (stats.completed + 0.5 * stats.inProgress)) / stats.total));
}
