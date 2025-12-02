// src/modules/reminders/reminders.service.ts
import {
    insertReminderRunRow,
    getBetsNeedingOpening,
    getKoQuestionsNeedingOpening,
    getBetsWithDeadlineToday,
    getKoQuestionsWithDeadlineToday,
    getUsersNeedingNotificationForBet,
    getUsersNeedingNotificationForKoQuestion,
    markBetsOpened,
    markKoQuestionsOpened,
    type ReminderUserContact,
} from "./reminders.repo";
import { sendPush } from "../push/push.service";
import { sendMail } from "../mail/mail.service";
import { env } from "../../config/env";

const MAIL_NOTIFICATIONS_ENABLED = env.reminders.sendMail;
// eslint-disable-next-line no-console
console.log("[reminders] MAIL_NOTIFICATIONS_ENABLED =", MAIL_NOTIFICATIONS_ENABLED);

export type ReminderMode = "opening" | "reminder";

export interface ReminderEventSummary {
    type: "bet" | "ko";
    id: number;
    label: string;
    kind: "opening" | "reminder";
    deadline?: string | null; // ISO or null
}

export interface ReminderUserSummary {
    userId: number;
    email?: string | null;
    pushSent: boolean;
    mailSent: boolean;
    events: ReminderEventSummary[];
}

export interface ReminderRunSummary {
    mode: ReminderMode;
    runStartedAt: string; // ISO UTC
    runEndedAt: string;   // ISO UTC
    totalUsersNotified: number;
    totalPushSent: number;
    totalMailSent: number;
    users: ReminderUserSummary[];
    meta: {
        notes?: string;
    };
}

/**
 * Main entry point used by the route:
 * - Dispatches to `runOpeningReminders` or `runDeadlineReminders`.
 * - Aggregates result into a JSON blob.
 * - Writes a row to `reminder_runs` ONLY if at least one user was notified.
 */
export async function runReminders(mode: ReminderMode): Promise<ReminderRunSummary> {
    const startedAt = new Date();
    // eslint-disable-next-line no-console
    console.log("[reminders] runReminders start", {
        mode,
        startedAt: startedAt.toISOString(),
    });

    let coreResult: Omit<
        ReminderRunSummary,
        "runStartedAt" | "runEndedAt" | "mode"
        > & { mode?: never };

    if (mode === "opening") {
        coreResult = await runOpeningRemindersCore();
    } else {
        coreResult = await runDeadlineRemindersCore();
    }

    const endedAt = new Date();

    const summary: ReminderRunSummary = {
        mode,
        runStartedAt: startedAt.toISOString(),
        runEndedAt: endedAt.toISOString(),
        totalUsersNotified: coreResult.totalUsersNotified,
        totalPushSent: coreResult.totalPushSent,
        totalMailSent: coreResult.totalMailSent,
        users: coreResult.users,
        meta: coreResult.meta,
    };

    // eslint-disable-next-line no-console
    console.log("[reminders] runReminders summary", {
        mode,
        totalUsersNotified: summary.totalUsersNotified,
        totalPushSent: summary.totalPushSent,
        totalMailSent: summary.totalMailSent,
        usersSample: summary.users.slice(0, 5).map((u) => ({
            userId: u.userId,
            eventsCount: u.events.length,
            pushSent: u.pushSent,
            mailSent: u.mailSent,
        })),
    });

    // Only persist if something actually happened.
    if (summary.totalUsersNotified > 0) {
        // eslint-disable-next-line no-console
        console.log("[reminders] inserting reminder_runs row");
        await insertReminderRunRow({
            runStartedAt: startedAt,
            runEndedAt: endedAt,
            payload: summary,
            status: "ok",
        });
    } else {
        // eslint-disable-next-line no-console
        console.log("[reminders] totalUsersNotified is 0 → not inserting reminder_runs row");
    }

    return summary;
}

/**
 * Opening mode:
 * - Finds bets + KO questions with notification=0 (and correct active/closed flags).
 * - For each event, finds users who have NOT yet answered.
 * - Aggregates per user:
 *      - Max one notification per user per run.
 *      - If user has multiple openings, we send "Inzenden geopend / Meerdere deadlines (N)".
 * - Sends push if user has an enabled device token, otherwise mail (if email present).
 * - Marks bet/ko_question as opened (opened = now, notification = 1).
 */
async function runOpeningRemindersCore(): Promise<{
    totalUsersNotified: number;
    totalPushSent: number;
    totalMailSent: number;
    users: ReminderUserSummary[];
    meta: { notes?: string };
}> {
    const now = new Date();
    // eslint-disable-next-line no-console
    console.log("[reminders/opening] runOpeningRemindersCore at", now.toISOString());

    const [bets, koQuestions] = await Promise.all([
        getBetsNeedingOpening(),
        getKoQuestionsNeedingOpening(),
    ]);

    // eslint-disable-next-line no-console
    console.log("[reminders/opening] candidates", {
        bets: bets.map((b) => ({ id: b.id, label: b.label, deadline: b.deadline })),
        koQuestions: koQuestions.map((k) => ({ id: k.id, label: k.label, deadline: k.deadline })),
    });

    const hasAnyEvents = bets.length > 0 || koQuestions.length > 0;
    if (!hasAnyEvents) {
        // eslint-disable-next-line no-console
        console.log("[reminders/opening] no bets/koQuestions needing opening → exit early");
        return {
            totalUsersNotified: 0,
            totalPushSent: 0,
            totalMailSent: 0,
            users: [],
            meta: {
                notes: "No bets or KO questions needing opening; nothing to do.",
            },
        };
    }

    type InternalUser = ReminderUserSummary & {
        deviceToken?: string | null;
    };

    const userMap = new Map<number, InternalUser>();
    const openedBetIds = new Set<number>();
    const openedKoIds = new Set<number>();

    // --- Collect users for Bets ---
    for (const bet of bets) {
        const contacts = await getUsersNeedingNotificationForBet(bet.id);
        // eslint-disable-next-line no-console
        console.log("[reminders/opening] bet contacts", {
            betId: bet.id,
            label: bet.label,
            contactsCount: contacts.length,
            firstContacts: contacts.slice(0, 5),
        });

        if (!contacts.length) {
            // Even if no users, we still consider the bet "opened".
            openedBetIds.add(bet.id);
            continue;
        }
        openedBetIds.add(bet.id);

        const event: ReminderEventSummary = {
            type: "bet",
            id: bet.id,
            label: bet.label,
            kind: "opening",
            deadline: bet.deadline ? bet.deadline.toISOString() : null,
        };

        attachEventToUsers(userMap, contacts, event);
    }

    // --- Collect users for KO Questions ---
    for (const ko of koQuestions) {
        const contacts = await getUsersNeedingNotificationForKoQuestion(ko.id);
        // eslint-disable-next-line no-console
        console.log("[reminders/opening] ko contacts", {
            koQuestionId: ko.id,
            label: ko.label,
            contactsCount: contacts.length,
            firstContacts: contacts.slice(0, 5),
        });

        if (!contacts.length) {
            openedKoIds.add(ko.id);
            continue;
        }
        openedKoIds.add(ko.id);

        const event: ReminderEventSummary = {
            type: "ko",
            id: ko.id,
            label: ko.label,
            kind: "opening",
            deadline: ko.deadline ? ko.deadline.toISOString() : null,
        };

        attachEventToUsers(userMap, contacts, event);
    }

    // eslint-disable-next-line no-console
    console.log("[reminders/opening] userMap after attach", {
        userCount: userMap.size,
        sampleUsers: [...userMap.values()].slice(0, 5).map((u) => ({
            userId: u.userId,
            email: u.email,
            deviceToken: (u as any).deviceToken,
            eventsCount: u.events.length,
        })),
        openedBetIds: [...openedBetIds],
        openedKoIds: [...openedKoIds],
    });

    // If no users ended up with events, we still mark opened, but no notifications.
    if (userMap.size === 0) {
        if (openedBetIds.size > 0 || openedKoIds.size > 0) {
            // eslint-disable-next-line no-console
            console.log("[reminders/opening] no eligible users, marking opened only", {
                openedBetIds: [...openedBetIds],
                openedKoIds: [...openedKoIds],
            });
            await Promise.all([
                openedBetIds.size ? markBetsOpened([...openedBetIds], now) : Promise.resolve(),
                openedKoIds.size ? markKoQuestionsOpened([...openedKoIds], now) : Promise.resolve(),
            ]);
        }
        return {
            totalUsersNotified: 0,
            totalPushSent: 0,
            totalMailSent: 0,
            users: [],
            meta: {
                notes:
                    "Opening run: events found, but no eligible users (all already answered or unreachable).",
            },
        };
    }

    // --- Send notifications (push OR mail) ---
    const allUsers = [...userMap.values()];
    // eslint-disable-next-line no-console
    console.log("[reminders/opening] sending notifications", {
        candidateUsers: allUsers.length,
        MAIL_NOTIFICATIONS_ENABLED,
    });

    let totalPushSent = 0;
    let totalMailSent = 0;

    for (const u of allUsers) {
        const events = u.events;
        if (!events.length) {
            // eslint-disable-next-line no-console
            console.log("[reminders/opening] user has no events, skipping", { userId: u.userId });
            continue;
        }

        const { title, body } = buildOpeningNotificationContent(events);
        const hasToken = !!(u as any).deviceToken;
        const hasEmail = !!u.email;

        // eslint-disable-next-line no-console
        console.log("[reminders/opening] per-user decision", {
            userId: u.userId,
            eventsCount: events.length,
            hasToken,
            hasEmail,
            title,
            body,
        });

        if (hasToken) {
            try {
                await sendPush({
                    token: (u as any).deviceToken as string,
                    title,
                    body,
                    data: {
                        kind: "opening",
                    },
                });
                u.pushSent = true;
                totalPushSent += 1;
                // eslint-disable-next-line no-console
                console.log("[reminders/opening] push sent", { userId: u.userId });
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error("[reminders/opening] push error for user", u.userId, err);
                u.pushSent = false;
            }
        } else if (!hasToken && hasEmail) {
            if (!MAIL_NOTIFICATIONS_ENABLED) {
                // eslint-disable-next-line no-console
                console.log(
                    "[reminders/opening] mail disabled → skipping mail send",
                    { userId: u.userId, email: u.email }
                );
                u.mailSent = false;
                continue;
            }

            try {
                await sendMail({
                    to: u.email as string,
                    subject: title,
                    body,
                });
                u.mailSent = true;
                totalMailSent += 1;
                // eslint-disable-next-line no-console
                console.log("[reminders/opening] mail sent", { userId: u.userId, email: u.email });
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error("[reminders/opening] mail error for user", u.userId, err);
                u.mailSent = false;
            }
        } else {
            // eslint-disable-next-line no-console
            console.log("[reminders/opening] user unreachable (no token, no email)", {
                userId: u.userId,
            });
        }
    }

    const notifiedUsers = allUsers.filter((u) => u.pushSent || u.mailSent);
    const totalUsersNotified = notifiedUsers.length;

    // Mark bets / KO questions as opened (even if some users failed).
    if (openedBetIds.size > 0 || openedKoIds.size > 0) {
        // eslint-disable-next-line no-console
        console.log("[reminders/opening] marking opened after notifications", {
            openedBetIds: [...openedBetIds],
            openedKoIds: [...openedKoIds],
        });
        await Promise.all([
            openedBetIds.size ? markBetsOpened([...openedBetIds], now) : Promise.resolve(),
            openedKoIds.size ? markKoQuestionsOpened([...openedKoIds], now) : Promise.resolve(),
        ]);
    }

    // eslint-disable-next-line no-console
    console.log("[reminders/opening] result", {
        totalUsersNotified,
        totalPushSent,
        totalMailSent,
    });

    return {
        totalUsersNotified,
        totalPushSent,
        totalMailSent,
        users: notifiedUsers,
        meta: {
            notes: `Opening run: bets=${bets.length}, koQuestions=${koQuestions.length}, usersNotified=${totalUsersNotified}`,
        },
    };
}

/**
 * Reminder mode:
 * - Selects today's deadlines (bets + KO) regardless of notification flag.
 * - For each event, finds users who have NOT yet answered.
 * - Aggregates per user:
 *      - Max one notification per user per run.
 *      - If user has multiple same-day deadlines, send "Herinnering / Meerdere deadlines (N)".
 *      - If exactly one event, send per-event text:
 *          • Bet: title = bet label, body = "Deadline over 15/3 uur"
 *          • KO:  title = "Knock-out", body = "Deadline over 15/3 uur"
 */
async function runDeadlineRemindersCore(): Promise<{
    totalUsersNotified: number;
    totalPushSent: number;
    totalMailSent: number;
    users: ReminderUserSummary[];
    meta: { notes?: string };
}> {
    const now = new Date();
    // eslint-disable-next-line no-console
    console.log("[reminders/reminder] runDeadlineRemindersCore at", now.toISOString());

    const [bets, koQuestions] = await Promise.all([
        getBetsWithDeadlineToday(),
        getKoQuestionsWithDeadlineToday(),
    ]);

    // eslint-disable-next-line no-console
    console.log("[reminders/reminder] candidates", {
        bets: bets.map((b) => ({ id: b.id, label: b.label, deadline: b.deadline })),
        koQuestions: koQuestions.map((k) => ({ id: k.id, label: k.label, deadline: k.deadline })),
    });

    const hasAnyEvents = bets.length > 0 || koQuestions.length > 0;
    if (!hasAnyEvents) {
        // eslint-disable-next-line no-console
        console.log("[reminders/reminder] no bets/koQuestions with deadline today → exit early");
        return {
            totalUsersNotified: 0,
            totalPushSent: 0,
            totalMailSent: 0,
            users: [],
            meta: {
                notes: "No bets or KO questions with deadlines today; nothing to do.",
            },
        };
    }

    type InternalUser = ReminderUserSummary & {
        deviceToken?: string | null;
    };

    const userMap = new Map<number, InternalUser>();

    // --- Collect users for Bets ---
    for (const bet of bets) {
        const contacts = await getUsersNeedingNotificationForBet(bet.id);
        // eslint-disable-next-line no-console
        console.log("[reminders/reminder] bet contacts", {
            betId: bet.id,
            label: bet.label,
            contactsCount: contacts.length,
            firstContacts: contacts.slice(0, 5),
        });

        if (!contacts.length) continue;

        const event: ReminderEventSummary = {
            type: "bet",
            id: bet.id,
            label: bet.label,
            kind: "reminder",
            deadline: bet.deadline ? bet.deadline.toISOString() : null,
        };

        attachEventToUsers(userMap, contacts, event);
    }

    // --- Collect users for KO Questions ---
    for (const ko of koQuestions) {
        const contacts = await getUsersNeedingNotificationForKoQuestion(ko.id);
        // eslint-disable-next-line no-console
        console.log("[reminders/reminder] ko contacts", {
            koQuestionId: ko.id,
            label: ko.label,
            contactsCount: contacts.length,
            firstContacts: contacts.slice(0, 5),
        });

        if (!contacts.length) continue;

        const event: ReminderEventSummary = {
            type: "ko",
            id: ko.id,
            label: ko.label,
            kind: "reminder",
            deadline: ko.deadline ? ko.deadline.toISOString() : null,
        };

        attachEventToUsers(userMap, contacts, event);
    }

    // eslint-disable-next-line no-console
    console.log("[reminders/reminder] userMap after attach", {
        userCount: userMap.size,
        sampleUsers: [...userMap.values()].slice(0, 5).map((u) => ({
            userId: u.userId,
            email: u.email,
            deviceToken: (u as any).deviceToken,
            eventsCount: u.events.length,
        })),
    });

    if (userMap.size === 0) {
        // eslint-disable-next-line no-console
        console.log("[reminders/reminder] events but no eligible users → exit");
        return {
            totalUsersNotified: 0,
            totalPushSent: 0,
            totalMailSent: 0,
            users: [],
            meta: {
                notes:
                    "Reminder run: events with deadlines today, but no eligible users (all already answered or unreachable).",
            },
        };
    }

    // --- Send notifications ---
    const allUsers = [...userMap.values()];
    // eslint-disable-next-line no-console
    console.log("[reminders/reminder] sending notifications", {
        candidateUsers: allUsers.length,
        MAIL_NOTIFICATIONS_ENABLED,
    });

    let totalPushSent = 0;
    let totalMailSent = 0;

    for (const u of allUsers) {
        const events = u.events;
        if (!events.length) {
            // eslint-disable-next-line no-console
            console.log("[reminders/reminder] user has no events, skipping", { userId: u.userId });
            continue;
        }

        const { title, body } = buildReminderNotificationContent(events, now);
        const hasToken = !!(u as any).deviceToken;
        const hasEmail = !!u.email;

        // eslint-disable-next-line no-console
        console.log("[reminders/reminder] per-user decision", {
            userId: u.userId,
            eventsCount: events.length,
            hasToken,
            hasEmail,
            title,
            body,
        });

        if (hasToken) {
            try {
                await sendPush({
                    token: (u as any).deviceToken as string,
                    title,
                    body,
                    data: {
                        kind: "reminder",
                    },
                });
                u.pushSent = true;
                totalPushSent += 1;
                // eslint-disable-next-line no-console
                console.log("[reminders/reminder] push sent", { userId: u.userId });
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error("[reminders/reminder] push error for user", u.userId, err);
                u.pushSent = false;
            }
        } else if (!hasToken && hasEmail) {
            if (!MAIL_NOTIFICATIONS_ENABLED) {
                // eslint-disable-next-line no-console
                console.log(
                    "[reminders/reminder] mail disabled → skipping mail send",
                    { userId: u.userId, email: u.email }
                );
                u.mailSent = false;
                continue;
            }

            try {
                await sendMail({
                    to: u.email as string,
                    subject: title,
                    body,
                });
                u.mailSent = true;
                totalMailSent += 1;
                // eslint-disable-next-line no-console
                console.log("[reminders/reminder] mail sent", { userId: u.userId, email: u.email });
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error("[reminders/reminder] mail error for user", u.userId, err);
                u.mailSent = false;
            }
        } else {
            // eslint-disable-next-line no-console
            console.log("[reminders/reminder] user unreachable (no token, no email)", {
                userId: u.userId,
            });
        }
    }

    const notifiedUsers = allUsers.filter((u) => u.pushSent || u.mailSent);
    const totalUsersNotified = notifiedUsers.length;

    // eslint-disable-next-line no-console
    console.log("[reminders/reminder] result", {
        totalUsersNotified,
        totalPushSent,
        totalMailSent,
    });

    return {
        totalUsersNotified,
        totalPushSent,
        totalMailSent,
        users: notifiedUsers,
        meta: {
            notes: `Reminder run: bets=${bets.length}, koQuestions=${koQuestions.length}, usersNotified=${totalUsersNotified}`,
        },
    };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function attachEventToUsers(
    userMap: Map<number, ReminderUserSummary & { deviceToken?: string | null }>,
    contacts: ReminderUserContact[],
    event: ReminderEventSummary
) {
    for (const c of contacts) {
        const existing = userMap.get(c.userId);
        if (!existing) {
            userMap.set(c.userId, {
                userId: c.userId,
                email: c.email ?? undefined,
                pushSent: false,
                mailSent: false,
                events: [event],
                deviceToken: c.deviceToken ?? null,
            });
        } else {
            existing.events.push(event);
            // Keep first known email/token; do not overwrite with null/undefined.
            if (!existing.email && c.email) existing.email = c.email;
            if (!existing.deviceToken && c.deviceToken) existing.deviceToken = c.deviceToken;
        }
    }
}

function buildOpeningNotificationContent(events: ReminderEventSummary[]): {
    title: string;
    body: string;
} {
    if (!events.length) {
        return { title: "Inzenden geopend", body: "Meerdere deadlines (0)" };
    }

    if (events.length === 1) {
        const ev = events[0];
        const dateStr = formatDutchDateShort(ev.deadline ? new Date(ev.deadline) : null) ?? "";
        if (ev.type === "bet") {
            return {
                title: ev.label,
                body: `Deadline: ${dateStr} om 23:59`,
            };
        }
        // KO
        return {
            title: "Knock-out",
            body: `Deadline: ${dateStr} om 23:59`,
        };
    }

    // Multiple openings
    const n = events.length;
    return {
        title: "Inzenden geopend",
        body: `Meerdere deadlines (${n})`,
    };
}

function buildReminderNotificationContent(
    events: ReminderEventSummary[],
    now: Date
): { title: string; body: string } {
    if (!events.length) {
        return { title: "Herinnering", body: "Meerdere deadlines (0)" };
    }

    if (events.length === 1) {
        const ev = events[0];
        const hoursLabel = computeHoursLabel(ev.deadline ?? null, now);
        if (ev.type === "bet") {
            return {
                title: ev.label,
                body: `Deadline over ${hoursLabel} uur`,
            };
        }
        // KO
        return {
            title: "Knock-out",
            body: `Deadline over ${hoursLabel} uur`,
        };
    }

    // Multiple deadlines (bet and/or KO) on same day
    const n = events.length;
    return {
        title: "Herinnering",
        body: `Meerdere deadlines (${n})`,
    };
}

function formatDutchDateShort(d: Date | null | undefined): string | null {
    if (!d || Number.isNaN(d.getTime())) return null;
    const day = `${d.getDate()}`.padStart(2, "0");
    const month = `${d.getMonth() + 1}`.padStart(2, "0");
    const year2 = `${d.getFullYear()}`.slice(-2);
    return `${day}/${month}/${year2}`;
}

/**
 * Compute whether to show "15" or "3" uur.
 * - If the deadline is on the same calendar day and >= ~8 hours away → 15.
 * - If the deadline is on the same day and < 8 hours away → 3.
 * - Fallback: 3.
 */
function computeHoursLabel(deadlineIso: string | null, now: Date): "15" | "3" {
    if (!deadlineIso) return "3";
    const d = new Date(deadlineIso);
    if (Number.isNaN(d.getTime())) return "3";

    const sameDay =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate();

    if (!sameDay) return "3";

    const diffMs = d.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    // At around 09:00 → ~15 hours; at 21:00 → ~3 hours.
    // Threshold 8 hours keeps behavior stable if cron runs slightly off.
    return diffHours > 8 ? "15" : "3";
}