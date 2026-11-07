import { Types } from 'mongoose';
import { titleSimilarity, type SimilarTaskDto } from '@arihant/shared';
import { requireAuth, type RequestContext } from '../../core/rbac/context';
import { taskReadFilter } from '../../core/rbac/work-access';
import { loadReadableProject } from '../projects/project.service';
import { Task } from '../tasks/task.model';

/** Titles at or above this similarity are reported as possible duplicates. */
export const SIMILARITY_THRESHOLD = 0.45;

/**
 * Possible duplicates of a (new or existing) task title within one project: open tasks and
 * tasks completed in the last 90 days that the caller can see. Text similarity only.
 */
export async function similarTasks(
  rc: RequestContext,
  projectId: string,
  title: string,
  excludeId?: string,
): Promise<SimilarTaskDto[]> {
  const auth = requireAuth(rc);
  const project = await loadReadableProject(auth, projectId);
  const since = new Date(Date.now() - 90 * 86_400_000);
  const candidates = await Task.find({
    $and: [
      { projectId: project._id, status: { $ne: 'cancelled' } },
      { $or: [{ status: { $ne: 'done' } }, { completedAt: { $gte: since } }] },
      ...(excludeId && Types.ObjectId.isValid(excludeId)
        ? [{ _id: { $ne: new Types.ObjectId(excludeId) } }]
        : []),
      await taskReadFilter(auth),
    ],
  })
    .select('key title status')
    .limit(2000)
    .lean();
  return candidates
    .map((t) => ({
      id: t._id.toString(),
      key: t.key,
      title: t.title,
      status: t.status,
      score: titleSimilarity(title, t.title),
    }))
    .filter((t) => t.score >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
