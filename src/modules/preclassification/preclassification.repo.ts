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

    // NOTE: keep the insertion parameter for API compatibility, but ignore it.
    async insertRow(betId: number, userId: number, points: number, sequence: number, seed: number, _insertion: string) {
        await this.pool.execute(
            `INSERT INTO preclassification (bet_id, user_id, points, sequence, seed, insertion)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [betId, userId, points, sequence, seed]
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

    async get_latest_two_sequences(bet_id: number) {
        const [rows] = await this.pool.query(
            `
      SELECT
        MAX(sequence)                                          AS latest,
        (SELECT MAX(sequence) FROM preclassification
          WHERE bet_id = ? AND sequence < MAX(p.sequence))     AS previous
      FROM preclassification p
      WHERE p.bet_id = ?
      `,
            [bet_id, bet_id]
        );
        const r = (rows as any[])[0] || {};
        return {
            latest: r.latest ? Number(r.latest) : null,
            previous: r.previous ? Number(r.previous) : null,
        } as { latest: number | null; previous: number | null };
    }

    async get_rows_for_sequence(bet_id: number, sequence: number) {
        const [rows] = await this.pool.query(
            `
      SELECT user_id, points, seed
      FROM preclassification
      WHERE bet_id = ? AND sequence = ?
      `,
            [bet_id, sequence]
        );
        return rows as Array<{ user_id: number; points: number; seed: number }>;
    }
}