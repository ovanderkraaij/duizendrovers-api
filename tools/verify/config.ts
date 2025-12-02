// tools/verify/config.ts
import fs from 'node:fs';
import path from 'node:path';

function loadEnvOnce() {
    // Use the existing .env in project root (no dotenv dep needed)
    const p = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(p)) return;
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const idx = line.indexOf('=');
        if (idx <= 0) continue;
        const key = line.slice(0, idx).trim();
        let val = line.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
    }
}

export interface DbCfg {
    host: string;
    port: number;
    user: string;
    pass: string;
    name: string;
    connLimit: number;
}

export interface VerifyConfig {
    seasonId: number;
    dryRun: boolean;
    apiBase?: string;
    src: DbCfg; // source = DB_NAME
    tgt: DbCfg; // target = DB_RULE_NAME
}

export function getConfig(argv = process.argv.slice(2)): VerifyConfig {
    loadEnvOnce();

    // CLI flags
    const args = new Map<string, string | true>();
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const [k, v] = a.includes('=') ? a.split('=') : [a, argv[i + 1]?.startsWith('--') ? 'true' : argv[++i]];
            args.set(k.replace(/^--/, ''), (v ?? 'true') as string);
        }
    }

    const seasonId = Number(args.get('season') ?? 0);
    if (!seasonId) throw new Error('Please pass --season <year>, e.g. --season 2025');

    const host = process.env.DB_HOST || '127.0.0.1';
    const port = Number(process.env.DB_PORT || 3306);
    const user = process.env.DB_USER || 'rover';
    const pass = process.env.DB_PASSWORD || '';
    const connLimit = Number(process.env.DB_CONN_LIMIT || 10);

    const srcName = process.env.DB_NAME || 'test1000rovers';
    const tgtName = process.env.DB_RULE_NAME || 'rules1000rovers';

    return {
        seasonId,
        dryRun: String(args.get('dry') ?? 'false') === 'true',
        apiBase: process.env.API_BASE || `http://127.0.0.1:${process.env.PORT || 3000}`,
        src: { host, port, user, pass, name: srcName, connLimit },
        tgt: { host, port, user, pass, name: tgtName, connLimit },
    };
}