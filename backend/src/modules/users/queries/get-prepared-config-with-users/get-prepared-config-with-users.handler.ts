import { Logger } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs';

import { HashedSet } from '@remnawave/hashed-set';

import { XRayConfig } from '@common/helpers/xray-config/xray-config.validator';
import { fail, ok, TResult } from '@common/types';
import { ERRORS } from '@libs/contracts/constants';

import { GetConfigProfileByUuidQuery } from '@modules/config-profiles/queries/get-config-profile-by-uuid';
import { GetSnippetsQuery } from '@modules/config-profiles/queries/get-snippets';
import { UsersRepository } from '@modules/users/repositories/users.repository';

import {
    GetPreparedConfigWithUsersQuery,
    IGetPreparedConfigWithUsersResponse,
} from './get-prepared-config-with-users.query';

@QueryHandler(GetPreparedConfigWithUsersQuery)
export class GetPreparedConfigWithUsersHandler implements IQueryHandler<
    GetPreparedConfigWithUsersQuery,
    TResult<IGetPreparedConfigWithUsersResponse>
> {
    private readonly logger = new Logger(GetPreparedConfigWithUsersHandler.name);
    constructor(
        private readonly usersRepository: UsersRepository,
        private readonly queryBus: QueryBus,
        private readonly db: PrismaService,
    ) {}

    async execute(
        query: GetPreparedConfigWithUsersQuery,
    ): Promise<TResult<IGetPreparedConfigWithUsersResponse>> {
        let config: XRayConfig | null = null;
        const inboundsUserSets: Map<string, HashedSet> = new Map();
        const snippetsMap: Map<string, unknown> = new Map();
        try {
            const { configProfileUuid, activeInbounds } = query;

            const configProfile = await this.queryBus.execute(
                new GetConfigProfileByUuidQuery(configProfileUuid),
            );

            const snippetsResponse = await this.queryBus.execute(new GetSnippetsQuery());

            if (!configProfile.isOk || !snippetsResponse.isOk) {
                return fail(ERRORS.INTERNAL_SERVER_ERROR);
            }

            for (const snippet of snippetsResponse.response) {
                snippetsMap.set(snippet.name, snippet.snippet);
            }

            const activeInboundsTags = new Set(activeInbounds.map((inbound) => inbound.tag));

            config = new XRayConfig(configProfile.response.config as object);

            config.cleanInboundClients(true);

            config.processCertificates();

            config.replaceSnippets(snippetsMap);

            const configHash = config.getConfigHash();

            config.leaveInbounds(activeInboundsTags);

            const usersStream = this.usersRepository.getUsersForConfigStream(activeInbounds);
            const blockedRows=query.nodeUuid?await this.db.$queryRaw<{t_id:bigint}[]>`SELECT u.t_id FROM user_node_quotas q JOIN users u ON u.uuid=q.user_uuid WHERE q.node_uuid=${query.nodeUuid}::uuid AND q.blocked`:[];
            const blocked=new Set(blockedRows.map(r=>r.t_id.toString()));

            for await (const userBatch of usersStream) {
                config.includeUserBatch(userBatch.filter(user=>!blocked.has(user.tId.toString())), inboundsUserSets);
            }

            for (const [tag, set] of inboundsUserSets) {
                this.logger.debug(`Inbound ${tag}: hash ${set.hash64String} and ${set.size} users`);
            }

            return ok({
                config: config.getConfig(),
                hashesPayload: {
                    emptyConfig: configHash,
                    inbounds: Array.from(inboundsUserSets.entries()).map(([tag, set]) => ({
                        usersCount: set.size,
                        hash: set.hash64String,
                        tag,
                    })),
                },
            });
        } catch (error) {
            this.logger.error(error);
            return fail(ERRORS.INTERNAL_SERVER_ERROR);
        } finally {
            config = null;
            for (const [, set] of inboundsUserSets) {
                set.clear();
            }
            inboundsUserSets.clear();
        }
    }
}
