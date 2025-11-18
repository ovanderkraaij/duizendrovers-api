// src/routes/predictions.ts
import { Router, type Request, type Response } from "express";
import { parseVirtualParam } from "../types/domain";
import { parseNumber } from "../utils/parse";
import * as svc from "../modules/predictions/predictions.service";

type Params = {
    bet_id: string;
    group_code: string;
    virtual: string;
    league_id: string;
    include_squads: string; // "0" | "1"
    user_id: string;
};

const router = Router();

/**
 * NEW (preferred): POST /api/v1/predictions/bundle
 * Body:
 * {
 *   "bet_id": number,
 *   "group_code": number,
 *   "virtual": 0|1|"real"|"virtual",
 *   "league_id": number,
 *   "include_squads": boolean,
 *   "user_id": number
 * }
 */
router.post("/bundle", async (req: Request, res: Response) => {
    try {
        const bet_id = parseNumber(req.body?.bet_id);
        const group_code = parseNumber(req.body?.group_code);
        const league_id = parseNumber(req.body?.league_id);
        const include_squads = !!req.body?.include_squads;
        const user_id = parseNumber(req.body?.user_id);
        const isVirtual = parseVirtualParam(String(req.body?.virtual ?? "0"));

        if (!bet_id || !group_code || !league_id || !user_id) {
            return res
                .status(400)
                .json({ error: "bet_id, group_code, league_id, and user_id are required" });
        }

        const result = await svc.composeBundle({
            betId: bet_id,
            groupCode: group_code,
            isVirtual,
            leagueId: league_id,
            includeSquads: include_squads,
            userIdForAnswers: user_id,
        });
        return res.json(result);
    } catch (err) {
        console.error("Error composing predictions bundle (POST /bundle):", err);
        return res.status(500).json({ error: "Failed to compose predictions bundle" });
    }
});

export default router;