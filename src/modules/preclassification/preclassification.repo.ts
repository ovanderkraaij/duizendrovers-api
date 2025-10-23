// src/modules/preclassification/preclassification.repo.ts
import { Pool } from 'mysql2/promise';

export class PreclassificationRepo {
    constructor(private pool: Pool) {}

    async getMaxSequence(betId: number) {
        const [rows] = await this.pool.execute(
            `SELECT MAX(sequence) as ms FROM preclassification WHERE bet_id=?`,
            [betId]
        );
        return (rows as any[])[0]?.ms ?? 1;
    }

    async deleteOlderSequences(betId: number, keepSequence: number) {
        await this.pool.execute(
            `DELETE FROM preclassification WHERE bet_id=? AND sequence < ?`,
            [betId, keepSequence]
        );
    }

    async insertRow(betId: number, userId: number, points: number, sequence: number, seed: number, insertion: string) {
        await this.pool.execute(
            `INSERT INTO preclassification (bet_id, user_id, points, sequence, seed, insertion) VALUES (?, ?, ?, ?, ?, ?)`,
            [betId, userId, points, sequence, seed, insertion]
        );
    }

    async aggregateTotals(betId: number) {
        const [rows] = await this.pool.execute(
            `SELECT SUM(a.points / q.average) AS totalpoints, a.user_id AS userId
       FROM answer a
       INNER JOIN question q ON a.question_id = q.id
       WHERE q.bet_id=? AND a.posted='1'
       GROUP BY a.user_id
       ORDER BY totalpoints DESC, userId ASC`,
            [betId]
        );
        return rows as { totalpoints: number; userId: number }[];
    }
}