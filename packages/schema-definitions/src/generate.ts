import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
    AlertRuleSchema,
    NormalizedTickerSchema,
    SidecarConfigPayloadSchema,
    SystemConfigSchema
} from '../../types/src/schemas/index.js';


const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '../schemas');

if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
}

const schemas = [
    { name: 'AlertRule', schema: AlertRuleSchema },
    { name: 'NormalizedTicker', schema: NormalizedTickerSchema },
    { name: 'SidecarConfigPayload', schema: SidecarConfigPayloadSchema },
    { name: 'SystemConfig', schema: SystemConfigSchema },
];

for (const { name, schema } of schemas) {
    const jsonSchema = zodToJsonSchema(schema, name);
    writeFileSync(
        join(OUTPUT_DIR, `${name}.json`),
        JSON.stringify(jsonSchema, null, 2)
    );
    console.log(`Generated ${name}.json`);
}
