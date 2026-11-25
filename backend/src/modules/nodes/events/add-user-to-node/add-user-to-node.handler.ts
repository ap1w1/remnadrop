import { Logger } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { IEventHandler, QueryBus } from '@nestjs/cqrs';
import { EventsHandler } from '@nestjs/cqrs';

import { AddUserCommand as AddUserToNodeCommandSdk } from '@remnawave/node-contract';

import {
    getCipherTypeFromString,
    getSsPassword,
    isSS2022Method,
} from '@common/helpers/xray-config/ss-cipher';
import { getVlessFlowFromDbInbound } from '@common/utils/flow/get-vless-flow';

import { ConfigProfileInboundEntity } from '@modules/config-profiles/entities/config-profile-inbound.entity';
import { GetUserWithResolvedInboundsQuery } from '@modules/users/queries/get-user-with-resolved-inbounds';

import { NodesQueuesService } from '@queue/_nodes';

import { NodesRepository } from '../../repositories/nodes.repository';
import { AddUserToNodeEvent } from './add-user-to-node.event';

@EventsHandler(AddUserToNodeEvent)
export class AddUserToNodeHandler implements IEventHandler<AddUserToNodeEvent> {
    public readonly logger = new Logger(AddUserToNodeHandler.name);

    constructor(
        private readonly nodesRepository: NodesRepository,
        private readonly nodesQueuesService: NodesQueuesService,
        private readonly queryBus: QueryBus,
        private readonly db: PrismaService,
    ) {}
    async handle(event: AddUserToNodeEvent, strict = false) {
        try {
            const userEntity = await this.queryBus.execute(
                new GetUserWithResolvedInboundsQuery(event.userUuid),
            );

            if (!userEntity.isOk) {
                if (strict) throw new Error('Cannot resolve user inbounds');
                return;
            }

            const { tId, trojanPassword, vlessUuid, ssPassword, inbounds } = userEntity.response;

            if (inbounds.length === 0 && !strict) {
                return;
            }

            const nodes = await this.nodesRepository.findConnectedNodes();
            const quotaRows=await this.db.$queryRaw<{node_uuid:string}[]>`SELECT node_uuid FROM user_node_quotas WHERE user_uuid=${event.userUuid}::uuid AND blocked`;
            const blockedNodes=new Set(quotaRows.map(q=>q.node_uuid));

            if (nodes.length === 0) {
                if (strict) throw new Error('No connected nodes; synchronization deferred');
                return;
            }

            const userData: AddUserToNodeCommandSdk.Request = {
                hashData: {
                    vlessUuid,
                    prevVlessUuid: event.prevVlessUuid,
                },

                data: inbounds.map((inbound) => {
                    const inboundType = this.resolveInboundType(inbound);

                    switch (inboundType) {
                        case 'trojan':
                            return {
                                type: inboundType,
                                username: tId.toString(),
                                password: trojanPassword,
                                tag: inbound.tag,
                            };
                        case 'vless':
                            return {
                                type: inboundType,
                                username: tId.toString(),
                                uuid: vlessUuid,
                                flow: getVlessFlowFromDbInbound(inbound),
                                tag: inbound.tag,
                            };
                        case 'shadowsocks':
                            return {
                                type: inboundType,
                                username: tId.toString(),
                                password: ssPassword,
                                tag: inbound.tag,
                                cipherType: getCipherTypeFromString(inbound.rawInbound),
                                ivCheck: false,
                            };
                        case 'shadowsocks22':
                            return {
                                type: inboundType,
                                username: tId.toString(),
                                password: getSsPassword(ssPassword, true),
                                tag: inbound.tag,
                            };
                        case 'hysteria':
                            return {
                                type: inboundType,
                                username: tId.toString(),
                                password: vlessUuid,
                                tag: inbound.tag,
                            };
                        default:
                            throw new Error(`Unsupported inbound type: ${inboundType}`);
                    }
                }),
            };

            for (const node of nodes) {
                if (node.activeInbounds.length === 0 || !node.activeConfigProfileUuid) {
                    continue;
                }

                const activeTags = new Set(node.activeInbounds.map((inbound) => inbound.tag));

                const filteredData = {
                    ...userData,
                    data: blockedNodes.has(node.uuid)?[]:userData.data.filter((item) => activeTags.has(item.tag)),
                };

                if (filteredData.data.length === 0) {
                    await this.nodesQueuesService.removeUserFromNode({
                        data: {
                            username: tId.toString(),
                            hashData: {
                                vlessUuid: event.prevVlessUuid || vlessUuid,
                            },
                        },
                        node: {
                            address: node.address,
                            port: node.port,
                            proxyUrl: node.proxyUrl,
                                backupProxyUrl: node.backupProxyUrl,
                        },
                    });

                    continue;
                }

                await this.nodesQueuesService.addUserToNode({
                    data: filteredData,
                    node: {
                        address: node.address,
                        port: node.port,
                        proxyUrl: node.proxyUrl,
                                backupProxyUrl: node.backupProxyUrl,
                    },
                });
            }

            return;
        } catch (error) {
            if (strict) throw error;
            this.logger.error(`Error in Event AddUserToNodeHandler: ${error}`);
        }
    }

    private resolveInboundType(inbound: ConfigProfileInboundEntity): string {
        if (inbound.type === 'shadowsocks' && isSS2022Method(inbound.rawInbound)) {
            return 'shadowsocks22';
        }
        return inbound.type;
    }
}
