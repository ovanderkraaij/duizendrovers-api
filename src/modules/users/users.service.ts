// src/modules/users/users.service.ts
import * as repo from "./users.repo";

export type BasicUser = {
    id: number;
    firstname: string | null;
    infix: string | null;
    lastname: string | null;
    email: string | null;
};

function mapUserRow(r: any): BasicUser {
    return {
        id: Number(r.id),
        firstname: r.firstname ?? null,
        infix: r.infix ?? null,
        lastname: r.lastname ?? null,
        email: r.email ?? null,
    };
}

/**
 * Service helpers, same style as squads.service.ts:
 * module-level functions calling the repo functions.
 */

export async function listForSeason(seasonId: number) {
    const rows = await repo.listBySeason(seasonId);
    return {
        users: rows.map(mapUserRow),
    };
}

export async function getById(userId: number): Promise<BasicUser | null> {
    const row = await repo.getUserById(userId);
    if (!row) return null;
    return mapUserRow(row);
}