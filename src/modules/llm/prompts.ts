// src/modules/llm/prompts.ts
export type Participant = { name: string; team?: string | null };

export type SportEventContext = {
    event: {
        id: number;
        title: string;                 // bet.label
        sport?: string;                // sport.label
        type?: "league" | "one_day";   // optional hint; works if absent
    };
    questions: Array<{ id: number; label: string }>;

    // Optional enrichments
    deadlineIso?: string;            // ISO 8601 → pick edition closest AFTER this
    participants?: Participant[];    // from list-type questions (deduped)
    officialUrl?: string;            // if provided → include “More info”; otherwise omit that section
    language?: "nl" | "en";
};

// Class to add to every <h4> so you can style headings easily
const HEADING_CLASS = "gbn-section";

export function sportEventSystemPrompt(lang: "nl" | "en" = "nl") {
    if (lang === "en") {
        return [
            "You are a helpful sports editor. Write clear, factual HTML (no Markdown).",
            "Use only facts present in the input or timeless context about the sport.",
            "- No hallucinations.",
            "- If date/venue aren’t certain, omit them.",
            "- Adapt the facts block to the event type:",
            "  • League / multi-venue: in “Facts & edition” include season/edition and format; don’t imply a single fixed venue.",
            "    If a final venue is known, you may add “Final: …”.",
            "  • One-day / one-venue (F1 race, classic, Indy 500, boat race, etc.): include date and venue (city, country) when reliable.",
            "- “Favourites & Dark Horses” must be ONE flowing paragraph with concrete names and short reasons.",
            "  Prefer the admin-provided participant list when grounding; otherwise pick current, reasonable contenders (no outdated legends).",
            "- Return exactly one HTML <div>…</div> (no H1/title; the page already has a title).",
            `- All section headings must be <h4 class="${HEADING_CLASS}">…</h4>.`,
            "- Links must use target=\"_blank\" and rel=\"noopener noreferrer\".",
            "- Include a “More info” section if an official URL is provided in the input, **or if the official website is universally known (e.g. formula1.com, uefa.com, letour.fr)**.",
            "- Never invent obscure or uncertain links; only use well-known, authoritative sites.",
            "- Aim for ~450–750 words; concise but substantial."
        ].join("\n");
    }

    // NL
    return [
        "Je bent een behulpzame sportredacteur. Schrijf helder en feitelijk in HTML (geen Markdown).",
        "Gebruik alleen feiten uit de input of algemeen geldende context over de sport.",
        "- Geen verzinsels.",
        "- Laat datum/locatie weg als die niet zeker zijn.",
        "- Pas de feitensectie aan op het type evenement:",
        "  • Competitie/league/multi-venue: noem bij “Feiten & editie” de editie/jaargang en de opzet; suggereer geen vaste locatie.",
        "    Als de finale-locatie bekend is, mag die genoemd worden (“Finale: …”).",
        "  • Eendaags/één locatie (F1-race, klassieker, Indy 500, bootrace): toon datum en locatie (stad, land) als betrouwbaar.",
        "- “Favorieten & Dark Horses” is ÉÉN doorlopende alinea met concrete namen en korte onderbouwing.",
        "  Gebruik bij voorkeur de aangeleverde deelnemerslijst; anders kies plausibele, actuele toppers (geen oude legendes).",
        "- Lever precies één HTML-container <div>…</div> (geen paginatitel/H1; die staat al op de pagina).",
        `- Alle sectiekoppen zijn <h4 class="${HEADING_CLASS}">…</h4>.`,
        "- Links altijd met target=\"_blank\" en rel=\"noopener noreferrer\".",
        "- Neem een sectie “Meer info” op als er een officiële URL is meegegeven, **of als de officiële website algemeen bekend is (bijv. formula1.com, uefa.com, letour.fr)**.",
        "- Verzin nooit onduidelijke of twijfelachtige links; gebruik alleen duidelijk officiële sites.",
        "- Mik op ~450–750 woorden: compact maar volwaardig."
    ].join("\n");
}

export function sportEventUserPrompt(ctx: SportEventContext) {
    const lang = ctx.language ?? "nl";
    const qLines =
        ctx.questions.length > 0
            ? ctx.questions.map((q) => `- (${q.id}) ${q.label}`).join("\n")
            : "—";

    const participantsBlock = (ctx.participants ?? [])
        .map((p) => `- ${p.name}${p.team ? ` (${p.team})` : ""}`)
        .join("\n");

    const hasParticipants = Boolean((ctx.participants ?? []).length);
    const deadlineIso = ctx.deadlineIso ?? "—";
    const officialUrl = (ctx.officialUrl ?? "").trim();
    const typeHint = ctx.event.type ? `\n- Type (hint): ${ctx.event.type}` : "";

    if (lang === "en") {
        return `
Use the data below to write a substantial **HTML** article for the event page.

Structure (all section headings must be <h4 class="${HEADING_CLASS}">):
1) Intro — 3–5 sentences about the upcoming edition; optionally one nod to history/records.
2) <h4 class="${HEADING_CLASS}">Facts & edition</h4> — 3–6 bullet facts, **adapted to event type** (see rules).
3) <h4 class="${HEADING_CLASS}">History & legacy</h4> — one paragraph (4–6 sentences) with notable past moments, champions or records (only if you’re confident).
4) <h4 class="${HEADING_CLASS}">What to watch</h4> — 2–4 sentences on tactics/storylines (track/course traits, weather, strategy, rivalries, rule tweaks).
5) <h4 class="${HEADING_CLASS}">Favourites & Dark Horses</h4> — one paragraph naming 2–3 favourites and 2–3 dark horses with concise reasons; prefer the provided participant list.
6) <h4 class="${HEADING_CLASS}">More info</h4> — include ONLY if an official URL is provided.

Data
- Event: ${ctx.event.title}
- Sport: ${ctx.event.sport || "Unknown"}${typeHint}
- Deadline (UTC/ISO 8601): ${deadlineIso}
- Questions users predict on:
${qLines}
${hasParticipants ? `- Optional participants (from admins; use to ground favourites/dark horses):\n${participantsBlock}` : ""}
- Official site (if provided): ${officialUrl || "—"}

Facts rules
- League / multi-venue (e.g., Champions League, Grand Tours):
  - Include: “Edition/season: <year>”, “Format: … (groups/knock-out/stage race)”, “Venues: multiple”
    or “Final: <city, country>” if known; “Title holder: …” if known.
  - Do not imply a single fixed venue.
- One-day / one-venue (F1 race, classic, Indy 500, boat race):
  - Include: “Date: <day month year>”, “Venue: <city, country>”, optional course/track trait,
    and “Title holder/record” if known.
- Omit any fact you can’t ground.

Output
Return exactly one HTML container like:
<div>
  <p>…intro…</p>
  <h4 class="${HEADING_CLASS}">Facts & edition</h4>
  <ul>
    <li>…</li>
  </ul>
  <h4 class="${HEADING_CLASS}">History & legacy</h4>
  <p>…</p>
  <h4 class="${HEADING_CLASS}">What to watch</h4>
  <p>…</p>
  <h4 class="${HEADING_CLASS}">Favourites & Dark Horses</h4>
  <p>…</p>
  ${officialUrl ? `<h4 class="${HEADING_CLASS}">More info</h4>\n  <p><a href="${officialUrl}" target="_blank" rel="noopener noreferrer">Official website</a></p>` : ""}
</div>

Important:
- No page title in the output.
- If no official URL is provided, omit the “More info” section entirely (no empty or placeholder links).
- Keep tone neutral, informative, and specific; avoid generic filler.
`.trim();
    }

    // NL
    return `
Gebruik onderstaande gegevens om een **HTML**-artikel te schrijven voor de evenementpagina.

Structuur (alle koppen als <h4 class="${HEADING_CLASS}">):
1) Intro — 3–5 zinnen over de komende editie; eventueel één zinnetje historie/records.
2) <h4 class="${HEADING_CLASS}">Feiten & editie</h4> — 3–6 puntsgewijze feiten, **aangepast aan het type** (zie regels).
3) <h4 class="${HEADING_CLASS}">Terugblik & geschiedenis</h4> — één alinea (4–6 zinnen) met opvallende momenten, kampioenen of records (alleen als je zeker bent).
4) <h4 class="${HEADING_CLASS}">Om in de gaten te houden</h4> — 2–4 zinnen over tactiek/verhaallijnen (parcours/baankenmerken, weer, strategie, rivaliteit, reglement).
5) <h4 class="${HEADING_CLASS}">Favorieten & Dark Horses</h4> — één alinea met 2–3 favorieten en 2–3 dark horses, met korte onderbouwing; gebruik waar mogelijk de deelnemerslijst.
6) <h4 class="${HEADING_CLASS}">Meer info</h4> — alleen opnemen als er een officiële URL is.

Data
- Evenement: ${ctx.event.title}
- Sport: ${ctx.event.sport || "Onbekend"}${typeHint}
- Deadline (UTC/ISO 8601): ${deadlineIso}
- Vragen waarop gebruikers voorspellen:
${qLines}
${hasParticipants ? `- Optionele deelnemers (door beheerders; gebruik om favorieten/dark horses te onderbouwen):\n${participantsBlock}` : ""}
- Officiële site (indien meegegeven): ${officialUrl || "—"}

Regels voor feiten
- Competitie / league / multi-venue (bijv. Champions League, grote ronden):
  - Toon: “Editie/jaargang: <jaar>”, “Opzet: … (groepsfase/knock-out/etappekoers)”, “Speelsteden/etappes: divers”
    of “Finale: <stad, land>” als bekend; “Titelhouder: …” als bekend.
  - Suggereer geen vaste locatie.
- Eendaags / één locatie (F1-race, klassieker, Indy 500, bootrace):
  - Toon: “Datum: <dag maand jaar>”, “Locatie: <stad, land)”, eventuele parcours/baankenmerken,
    en “Titelhouder/record” als bekend.
- Laat elk feit weg als het niet zeker is.

Uitvoer
Geef precies één HTML-container zoals:
<div>
  <p>…intro…</p>
  <h4 class="${HEADING_CLASS}">Feiten & editie</h4>
  <ul>
    <li>…</li>
  </ul>
  <h4 class="${HEADING_CLASS}">Terugblik & geschiedenis</h4>
  <p>…</p>
  <h4 class="${HEADING_CLASS}">Om in de gaten te houden</h4>
  <p>…</p>
  <h4 class="${HEADING_CLASS}">Favorieten & Dark Horses</h4>
  <p>…</p>
  ${officialUrl ? `<h4 class="${HEADING_CLASS}">Meer info</h4>\n  <p><a href="${officialUrl}" target="_blank" rel="noopener noreferrer">Officiële website</a></p>` : ""}
</div>

Belangrijk:
- Geen paginatitel in de uitvoer.
- Als er geen officiële URL is, laat “Meer info” volledig weg (geen lege of placeholder-links).
- Houd de toon neutraal, informatief en specifiek; vermijd generieke vulling.
`.trim();
}