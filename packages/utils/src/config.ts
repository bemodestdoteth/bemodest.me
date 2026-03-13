/**
 * Interpolates environment variables into strings or arrays of strings
 * @param {string|string[]|any} value
 * @returns {any}
 */
export function interpolateSecrets(value: any): any {
    if (typeof value === 'string') {
        return value.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? `\${${key}}`);
    }
    if (Array.isArray(value)) return value.map(interpolateSecrets);
    return value;
}
