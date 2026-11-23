import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@common/database/prisma.service';

import { certificateExpiry, validateSslCertificate } from './panel-events.validation';

interface CertificateRow {
    id: string;
    name: string;
    domains: string[];
    expires_at: Date;
    reminder_days: number[];
    enabled: boolean;
    created_at: Date;
    updated_at: Date;
    nodes: { uuid: string; name: string }[];
}

@Injectable()
export class SslCertificatesService {
    constructor(private readonly db: PrismaService) {}

    private validate(body: unknown) {
        try { return validateSslCertificate(body); }
        catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Некорректные параметры сертификата'); }
    }

    private async rows(id?: string) {
        return this.db.$queryRaw<CertificateRow[]>(Prisma.sql`
            SELECT c.*,
                coalesce(jsonb_agg(jsonb_build_object('uuid',n.uuid,'name',n.name) ORDER BY n.name)
                    FILTER (WHERE n.uuid IS NOT NULL),'[]'::jsonb) AS nodes
            FROM ssl_certificates c
            LEFT JOIN ssl_certificate_nodes cn ON cn.certificate_id=c.id
            LEFT JOIN nodes n ON n.uuid=cn.node_uuid
            ${id ? Prisma.sql`WHERE c.id=${id}::uuid` : Prisma.empty}
            GROUP BY c.id ORDER BY c.expires_at,c.name`);
    }

    private serialize(row: CertificateRow) {
        return {
            id: row.id,
            name: row.name,
            domains: row.domains,
            nodeUuids: row.nodes.map(node => node.uuid),
            nodes: row.nodes,
            expiresAt: row.expires_at,
            reminderDays: row.reminder_days,
            enabled: row.enabled,
            ...certificateExpiry(row.expires_at, row.reminder_days, row.enabled),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    async list() {
        return { response: { items: (await this.rows()).map(row => this.serialize(row)) } };
    }

    async save(adminUuid: string, body: unknown, existingId?: string) {
        const input = this.validate(body);
        const id = existingId ?? randomUUID();
        await this.db.$transaction(async tx => {
            if (existingId) {
                const found = await tx.$queryRaw<{ id: string }[]>`
                    SELECT id FROM ssl_certificates WHERE id=${id}::uuid FOR UPDATE`;
                if (!found.length) throw new NotFoundException('Сертификат не найден');
            }
            const nodes = await tx.$queryRaw<{ uuid: string }[]>`
                SELECT uuid FROM nodes WHERE uuid=ANY(${input.nodeUuids}::uuid[]) FOR KEY SHARE`;
            if (nodes.length !== input.nodeUuids.length) throw new BadRequestException('Одна из выбранных нод больше не существует');
            if (existingId) {
                await tx.$executeRaw`
                    UPDATE ssl_certificates SET name=${input.name},domains=${input.domains}::text[],
                        expiry_revision=expiry_revision+CASE WHEN expires_at IS DISTINCT FROM ${input.expiresAt} THEN 1 ELSE 0 END,
                        expires_at=${input.expiresAt},reminder_days=${input.reminderDays}::integer[],
                        enabled=${input.enabled},updated_at=now()
                    WHERE id=${id}::uuid`;
                await tx.$executeRaw`DELETE FROM ssl_certificate_nodes WHERE certificate_id=${id}::uuid`;
            } else {
                await tx.$executeRaw`
                    INSERT INTO ssl_certificates(id,name,domains,expires_at,reminder_days,enabled,created_by)
                    VALUES(${id}::uuid,${input.name},${input.domains}::text[],${input.expiresAt},
                        ${input.reminderDays}::integer[],${input.enabled},${adminUuid}::uuid)`;
            }
            await tx.$executeRaw`
                INSERT INTO ssl_certificate_nodes(certificate_id,node_uuid)
                    SELECT ${id}::uuid,unnest(${input.nodeUuids}::uuid[])`;
        });
        const rows = await this.rows(id);
        return { response: this.serialize(rows[0]) };
    }

    async remove(id: string) {
        const changed = await this.db.$executeRaw`DELETE FROM ssl_certificates WHERE id=${id}::uuid`;
        if (!changed) throw new NotFoundException('Сертификат не найден');
        return { response: { success: true } };
    }
}
