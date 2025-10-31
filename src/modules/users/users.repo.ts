//src/modules/users/users.repo.ts
import { Pool } from "mysql2/promise";

export class UsersRepo {
    constructor(private pool: Pool) {}
    async listBySeason(seasonId: number) {
        const [rows] = await this.pool.query(
            `
      SELECT u.id, u.firstname, u.infix, u.lastname, u.email
      FROM users_season us
      JOIN users u ON u.id = us.user_id
      WHERE us.season_id = ?
      ORDER BY u.firstname, u.lastname
      `,
            [seasonId]
        );
        return rows as any[];
    }
}