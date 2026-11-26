import { Job } from 'bullmq';
import { SquadQuotasService } from '@modules/squad-quotas/squad-quotas.service';

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

import { ok } from '@common/types';
import { EVENTS } from '@libs/contracts/constants';


import { UsersQueuesService } from '@queue/_users/users-queues.service';
import { QUEUES_NAMES } from '@queue/queue.enum';

import { USERS_JOB_NAMES } from '../constants/users-job-name.constant';
import type { IUserUsageDelta } from '../interfaces/user-usage.interface';

@Processor(QUEUES_NAMES.USERS.UPDATE_USERS_USAGE, {
    concurrency: 5,
})
export class UpdateUsersUsageQueueProcessor extends WorkerHost {
    private readonly logger = new Logger(UpdateUsersUsageQueueProcessor.name);

    constructor(
        private readonly usersQueuesService: UsersQueuesService,
        private readonly squadQuotasService: SquadQuotasService,
    ) {
        super();
    }

    async process(job: Job) {
        switch (job.name) {
            case USERS_JOB_NAMES.UPDATE_USERS_USAGE:
                return await this.handleUpdateUsersUsage(job);
            default:
                this.logger.warn(`Job "${job.name}" is not handled.`);
                break;
        }
    }

    private async handleUpdateUsersUsage(job: Job<IUserUsageDelta[]>) {
        try {
            const userUsageList = job.data;

            const updatedUsers = await this.squadQuotasService.record(`users-usage:${job.id}`, userUsageList, true);

            if (updatedUsers.length > 0) {
                await this.usersQueuesService.fireUserEventBulk({
                    users: updatedUsers,
                    userEvent: EVENTS.USER.FIRST_CONNECTED,
                });
            }

            return ok({
                affectedRows: userUsageList.length,
            });
        } catch (error) {
            this.logger.error(
                `Error handling "${USERS_JOB_NAMES.UPDATE_USERS_USAGE}" job: ${error}`,
            );

            throw error;
        }
    }
}
