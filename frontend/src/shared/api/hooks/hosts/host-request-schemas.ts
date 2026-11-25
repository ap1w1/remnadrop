import { CreateHostCommand, UpdateHostCommand } from '@remnawave/backend-contract'
import { z } from 'zod'

// The frontend consumes the published contract package; keep its remark limit
// aligned with the fork's backend contract until the published package catches up.
export const createHostRequestSchema = CreateHostCommand.RequestSchema.extend({
    remark: z.string().min(1, 'Remark must be at least 1 character').max(120, 'Remark must be 120 characters or fewer')
})

export const updateHostRequestSchema = UpdateHostCommand.RequestSchema.extend({
    remark: z.string().max(120, 'Remark must be 120 characters or fewer').optional()
})
