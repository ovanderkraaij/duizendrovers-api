// src/modules/solutions/__tests__/solutions.service.spec.ts
import { SolutionsService } from "../../solutions/solutions.service";

type Row = Record<string, any>;
class FakeRepo {
    public resets: any[] = [];
    public batches: any[] = [];
    constructor(
        private data: {
            mains: Row[];
            groupsByCode: Record<number, Row[]>;
            rtypes: Row[];
            solutions: Row[];
            posted: Row[];
            allAnswersInBet: Row[];
        }
    ) {}
    async resetCorrectAndScoreForBet(betId: number) { this.resets.push(betId); }
    async getMainQuestionsForBet(betId: number) { return this.data.mains; }
    async getGroupQuestions(groupcode: number) { return this.data.groupsByCode[groupcode] ?? []; }
    async getResulttypesForQids(qids: number[]) {
        return this.data.rtypes.filter(r => qids.includes(Number(r.qid)));
    }
    async getSolutionsForQids(qids: number[]) {
        return this.data.solutions.filter(r => qids.includes(Number(r.question_id)));
    }
    async getPostedAnswersForBet(_betId: number) { return this.data.posted; }
    async getAllAnswersForQidsInBet(_betId: number, qids: number[]) {
        return this.data.allAnswersInBet.filter(r => qids.includes(Number(r.question_id)));
    }
    async batchUpdateCorrectScoreByAnswerId(upds: any[]) { this.batches.push(upds); }
}

describe("SolutionsService.markCorrectAndScore", () => {
    test("Singles: divide points among identical correct answers", async () => {
        const fake = new FakeRepo({
            mains: [], // no bundles
            groupsByCode: {},
            rtypes: [{ qid: 11, rt_label: "open" }],
            solutions: [{ question_id: 11, result: "OK", listitem_id: null }],
            posted: [
                { id: 1, user_id: 10, question_id: 11, result: "OK", listitem_id: null, answer_points: 5, question_points: 10 },
                { id: 2, user_id: 11, question_id: 11, result: "OK", listitem_id: null, answer_points: 5, question_points: 10 },
                { id: 3, user_id: 12, question_id: 11, result: "NO", listitem_id: null, answer_points: 5, question_points: 10 },
            ],
            allAnswersInBet: [],
        });
        const svc = new SolutionsService(fake as any);
        await svc.markCorrectAndScore(999);

        // two winners split 10 => 5 each
        const lastBatch = (fake.batches.at(-1) as any[]).sort((a, b) => a.answerId - b.answerId);
        expect(lastBatch).toEqual([
            { answerId: 1, correct: 1, score: 5 },
            { answerId: 2, correct: 1, score: 5 },
            { answerId: 3, correct: 0, score: 0 },
        ]);
    });

    test("Main+Subs bundle: only main gets divided score when all subs correct", async () => {
        const fake = new FakeRepo({
            mains: [{ id: 20, groupcode: 7 }],
            groupsByCode: {
                7: [
                    { id: 20, points: 10 }, // main
                    { id: 21, points: 0 },  // sub
                    { id: 22, points: 0 },  // sub
                ]
            },
            rtypes: [
                { qid: 20, rt_label: "open" },
                { qid: 21, rt_label: "open" },
                { qid: 22, rt_label: "open" },
            ],
            solutions: [
                { question_id: 20, result: "A", listitem_id: null },
                { question_id: 21, result: "B", listitem_id: null },
                { question_id: 22, result: "C", listitem_id: null },
            ],
            posted: [
                // user 1 correct all
                { id: 1, user_id: 1, question_id: 20, result: "A", listitem_id: null, answer_points: 10, question_points: 10 },
                { id: 2, user_id: 1, question_id: 21, result: "B", listitem_id: null, answer_points: 0, question_points: 0 },
                { id: 3, user_id: 1, question_id: 22, result: "C", listitem_id: null, answer_points: 0, question_points: 0 },
                // user 2 wrong sub
                { id: 4, user_id: 2, question_id: 20, result: "A", listitem_id: null, answer_points: 10, question_points: 10 },
                { id: 5, user_id: 2, question_id: 21, result: "X", listitem_id: null, answer_points: 0, question_points: 0 },
                { id: 6, user_id: 2, question_id: 22, result: "C", listitem_id: null, answer_points: 0, question_points: 0 },
            ],
            allAnswersInBet: [],
        });
        const svc = new SolutionsService(fake as any);
        await svc.markCorrectAndScore(999);

        // Only user 1 wins; main gets 10; subs 0/0 for all
        const batch = fake.batches.at(-1) as any[];
        const byId = new Map(batch.map((u: any) => [u.answerId, u]));
        expect(byId.get(1)).toEqual({ answerId: 1, correct: 1, score: 10 });
        expect(byId.get(4)).toEqual({ answerId: 4, correct: 0, score: 0 });
        [2,3,5,6].forEach(id => expect(byId.get(id)).toEqual({ answerId: id, correct: 0, score: 0 }));
    });

    test("Bonuses: only first bonus gets sum(points) divided among perfect bundles", async () => {
        const fake = new FakeRepo({
            mains: [{ id: 30, groupcode: 9 }],
            groupsByCode: {
                9: [
                    { id: 30, points: 10 }, // main
                    { id: 31, points: 5 },  // bonus 1 (first)
                    { id: 32, points: 7 },  // bonus 2
                ]
            },
            rtypes: [
                { qid: 30, rt_label: "open" },
                { qid: 31, rt_label: "open" },
                { qid: 32, rt_label: "open" },
            ],
            solutions: [
                { question_id: 30, result: "M", listitem_id: null },
                { question_id: 31, result: "B1", listitem_id: null },
                { question_id: 32, result: "B2", listitem_id: null },
            ],
            posted: [
                // user 1 perfect
                { id: 1, user_id: 1, question_id: 30, result: "M", listitem_id: null, answer_points: 10, question_points: 10 },
                { id: 2, user_id: 1, question_id: 31, result: "B1", listitem_id: null, answer_points: 5, question_points: 5 },
                { id: 3, user_id: 1, question_id: 32, result: "B2", listitem_id: null, answer_points: 7, question_points: 7 },
                // user 2 wrong bonus 2
                { id: 4, user_id: 2, question_id: 30, result: "M", listitem_id: null, answer_points: 10, question_points: 10 },
                { id: 5, user_id: 2, question_id: 31, result: "B1", listitem_id: null, answer_points: 5, question_points: 5 },
                { id: 6, user_id: 2, question_id: 32, result: "X",  listitem_id: null, answer_points: 7, question_points: 7 },
            ],
            allAnswersInBet: [],
        });
        const svc = new SolutionsService(fake as any);
        await svc.markCorrectAndScore(999);

        // pot = 5+7 = 12; winners = [user1] → first bonus (id 2) gets 12; others 0/0
        const byId = new Map((fake.batches.at(-1) as any[]).map((u: any) => [u.answerId, u]));
        expect(byId.get(2)).toEqual({ answerId: 2, correct: 1, score: 12 });
        [1,3,4,5,6].forEach(id => expect(byId.get(id)).toEqual({ answerId: id, correct: 0, score: 0 }));
    });

    test("Margin: mark exactly the matching variant (prefer posted) with its stored points", async () => {
        const fake = new FakeRepo({
            mains: [],
            groupsByCode: {},
            rtypes: [{ qid: 40, rt_label: "decimal", q_margin: 1, q_step: 0.5 }],
            solutions: [{ question_id: 40, result: "270.5", listitem_id: null }],
            posted: [
                // posted center
                { id: 1, user_id: 1, question_id: 40, result: "270.5", listitem_id: null, answer_points: 6, question_points: 10, posted: '1' },
            ],
            allAnswersInBet: [
                // same user variants; winner should be the exact matching (posted preferred if equal result)
                { id: 1, user_id: 1, question_id: 40, result: "270.5", listitem_id: null, answer_points: 6, posted: '1' },
                { id: 2, user_id: 1, question_id: 40, result: "270.0", listitem_id: null, answer_points: 3, posted: '0' },
                { id: 3, user_id: 1, question_id: 40, result: "271.0", listitem_id: null, answer_points: 3, posted: '0' },
            ],
        });
        const svc = new SolutionsService(fake as any);
        await svc.markCorrectAndScore(999);

        const byId = new Map((fake.batches.at(-1) as any[]).map((u: any) => [u.answerId, u]));
        expect(byId.get(1)).toEqual({ answerId: 1, correct: 1, score: 6 });
        expect(byId.get(2)).toEqual({ answerId: 2, correct: 0, score: 0 });
        expect(byId.get(3)).toEqual({ answerId: 3, correct: 0, score: 0 });
    });
});