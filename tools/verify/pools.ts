import { createPool, Pool } from 'mysql2/promise';
import type { VerifyConfig } from './config';

export function makePools(cfg: VerifyConfig) {
    const src: Pool = createPool({
        host: cfg.src.host,
        port: cfg.src.port,
        user: cfg.src.user,
        password: cfg.src.pass,
        database: cfg.src.name,
        waitForConnections: true,
        connectionLimit: cfg.src.connLimit,
        multipleStatements: true,
    });

    const tgt: Pool = createPool({
        host: cfg.tgt.host,
        port: cfg.tgt.port,
        user: cfg.tgt.user,
        password: cfg.tgt.pass,
        database: cfg.tgt.name,
        waitForConnections: true,
        connectionLimit: cfg.tgt.connLimit,
        multipleStatements: true,
    });

    return { src, tgt };
}