//src/modules/users/users.service.ts
import { UsersRepo } from "./users.repo";

export class UsersService {
    constructor(private repo: UsersRepo) {}
    async listForSeason(seasonId: number) {
        const rows = await this.repo.listBySeason(seasonId);
        return {
            users: rows.map(r => ({
                id: Number(r.id),
                firstname: r.firstname ?? null,
                infix: r.infix ?? null,
                lastname: r.lastname ?? null,
                email: r.email ?? null,
            })),
        };
    }
}