/**
 * Persist Cody fine-tuning trajectories to ZeroDB (table: cody_trajectories).
 * Mirrors the write pattern in lib/services/rlhf.service.ts. Fire-and-forget:
 * capture must never affect the generation path.
 */
import { AINATIVE_API_BASE_URL } from '@/lib/constants'
import type { TrajectoryRecord } from './trajectory-capture'

const TRAJECTORY_TABLE = 'cody_trajectories'

function projectId(): string {
  return process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
}

function token(): string | undefined {
  return (
    process.env.ZERODB_API_TOKEN ||
    process.env.AINATIVE_API_KEY ||
    process.env.ANTHROPIC_API_KEY
  )
}

/** Store one labeled trajectory. Returns true on success. Never throws. */
export async function storeTrajectory(record: TrajectoryRecord): Promise<boolean> {
  const tok = token()
  if (!tok) {
    console.warn('[Trajectory] no ZeroDB token — skipping capture')
    return false
  }
  try {
    const res = await fetch(
      `${AINATIVE_API_BASE_URL}/api/v1/projects/${projectId()}/database/tables/${TRAJECTORY_TABLE}/rows`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tok}`,
          'Content-Type': 'application/json',
        },
        // Steps/file_tree serialized so the row stays schema-flexible, matching
        // how full_conversation is stored in rlhf_training_data.
        body: JSON.stringify({
          row_data: {
            chat_id: record.chat_id,
            task: record.task,
            model: record.model,
            num_turns: record.num_turns,
            total_cost_usd: record.total_cost_usd,
            duration_ms: record.duration_ms,
            is_error: record.is_error,
            reward: record.verify.reward,
            verify_installed: record.verify.installed,
            verify_built: record.verify.built,
            verify_detail: record.verify.detail,
            file_count: record.file_tree.length,
            file_tree: JSON.stringify(record.file_tree),
            steps: JSON.stringify(record.steps),
            created_at: record.created_at,
          },
        }),
      },
    )
    if (!res.ok) {
      console.warn(`[Trajectory] store failed: HTTP ${res.status}`)
      return false
    }
    console.log(
      `[Trajectory] captured ${record.chat_id}: ${record.steps.length} steps, ${record.file_tree.length} files, reward=${record.verify.reward} (${record.verify.detail})`,
    )
    return true
  } catch (err) {
    console.warn('[Trajectory] store error:', err instanceof Error ? err.message : err)
    return false
  }
}
