// The sources registry (docs/MULTILINGUAL.md, "The registry"), as the stages that need a source's
// community read it: corroboration (decision D6) and the benchmark. Node only: it reads data/sources/.
import fs from 'node:fs';
import path from 'node:path';
import type { SourceId } from '../models/text.model';

/** Each registered source's community, from its source.json. */
export function sourceCommunities(sourcesDir: string): Map<SourceId, string> {
    const communities = new Map<SourceId, string>();
    for (const id of fs.readdirSync(sourcesDir).sort()) {
        const file = path.join(sourcesDir, id, 'source.json');
        if (!fs.existsSync(file)) continue;
        const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (typeof raw === 'object' && raw !== null && 'community' in raw && typeof raw.community === 'string') communities.set(id, raw.community);
    }
    return communities;
}
