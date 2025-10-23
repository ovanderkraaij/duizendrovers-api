import { QuestionsRepo } from "./questions.repo";

/**
 * Thin service wrapper for question operations.
 * Keeps business logic separate from direct SQL in the repo.
 */
export class QuestionService {
    constructor(private repo: QuestionsRepo) {}

    /** Return all main questions (no parent) for a bet. */
    async getMainQuestions(betId: number) {
        return this.repo.getMainQuestions(betId);
    }

    /** Return all sub-questions and bonus questions for a given group code. */
    async getGroupQuestions(groupcode: number) {
        return this.repo.getGroupQuestions(groupcode);
    }

    /** Return only sub-questions (points = 0). */
    async getSubs(groupcode: number) {
        return this.repo.getSubs(groupcode);
    }

    /** Return only bonus questions (points ≠ 0). */
    async getBonuses(groupcode: number) {
        return this.repo.getBonuses(groupcode);
    }

    /** Return the result type label for a question’s resulttype_id. */
    async getResultTypeLabel(resulttypeId: number) {
        return this.repo.getResultTypeLabel(resulttypeId);
    }
}