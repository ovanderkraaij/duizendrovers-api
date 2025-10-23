import fs from 'node:fs';
import path from 'node:path';

export function nowStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}
export function ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
export function writeTextReport(dir: string, base: string, text: string) {
    ensureDir(dir);
    const file = path.join(dir, `${base}-${nowStamp()}.txt`);
    fs.writeFileSync(file, text, 'utf8');
    return file;
}
export function writeJsonReport(dir: string, base: string, obj: any) {
    ensureDir(dir);
    const file = path.join(dir, `${base}-${nowStamp()}.json`);
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
    return file;
}