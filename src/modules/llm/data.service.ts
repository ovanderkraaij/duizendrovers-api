// src/modules/llm/data.service.ts
import { pool } from "../../db";
import { llmLog } from "./llm.debug";

/** Convert "YYYY-MM-DD HH:MM:SS" (MySQL) to ISO 8601 in UTC. */
/** Convert MySQL DATETIME/TIMESTAMP to ISO 8601 (UTC).
 *  Accepts Date | string | null and is defensive against odd formats.
 */
function mysqlToIso(mysql: Date | string | null | undefined): string | null {
    if (!mysql) return null;

    // If the driver already gave us a Date
    if (mysql instanceof Date) {
        const t = mysql.getTime();
        if (isNaN(t)) return null;
        return new Date(t).toISOString(); // UTC
    }

    // Otherwise coerce to string
    const raw = String(mysql).trim();
    if (!raw) return null;

    // Normalize "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SSZ"
    const withT = raw.includes("T") ? raw : raw.replace(" ", "T");
    const withZ = /Z$/.test(withT) ? withT : withT + "Z";

    const d = new Date(withZ);
    if (isNaN(d.getTime())) return null;

    return d.toISOString(); // UTC
}

export async function getEventBasics(eventId: number) {
    const [rows] = await pool.query(
        `select bet.id,
            bet.label as eventTitle,
            bet.deadline as eventDeadline,
            sport.id  as sportId,
            sport.label as sportLabel
     from bet
     inner join sport on bet.sport_id = sport.id
     where bet.id = ?
     limit 1`,
        [eventId]
    );
    const r = Array.isArray(rows) ? (rows as any[])[0] : null;
    if (!r) return null;

    const ret = {
        id: r.id,
        title: String(r.eventTitle ?? ""),
        sport: String(r.sportLabel ?? ""),
        deadlineIso: mysqlToIso(r.eventDeadline ?? null) || undefined,
    };

    llmLog("eventBasics", ret);
    return ret;
}

export async function getBetQuestionsForEvent(eventId: number) {
    const [rows] = await pool.query(
        `select q.id, q.label
     from question q
     where q.bet_id = ?
     order by q.id asc`,
        [eventId]
    );
    const list = (rows as any[]).map(r => ({ id: r.id, label: String(r.label ?? "") }));
    llmLog(`questions(\${list.length})`, list.slice(0, 5));
  return list;
}

/**
 * Collect a flat list of participants for all list-type questions of this bet.
 * Deduped by name+team.
 */
export async function getParticipantsForListQuestions(eventId: number) {
  const [rows] = await pool.query(
    `
    select distinct
    coalesce(item.label, '')       as name,
        coalesce(team.label, '')       as team,
        rt.label                       as resulttype
    from question q
    inner join resulttype rt on rt.id = q.resulttype_id
    inner join question_list ql on ql.question_id = q.id
    inner join list l on l.id = ql.list_id
    left  join listitem li on li.list_id = l.id
    left  join item on item.id = li.item_id
    left  join team on team.id = item.team_id
    where q.bet_id = ?
        and lower(rt.label) = 'list'
            `,
    [eventId]
  );

  const seen = new Set<string>();
  const participants = [];
  for (const r of rows as any[]) {
    const name = String(r.name || "").trim();
    const team = String(r.team || "").trim() || null;
    if (!name) continue;
    const key = name.toLowerCase() + "||" + (team || "");
    if (seen.has(key)) continue;
    seen.add(key);
    participants.push({ name, team });
  }

  llmLog(`participants(${participants.length})`, participants.slice(0, 5));
  return participants;
}