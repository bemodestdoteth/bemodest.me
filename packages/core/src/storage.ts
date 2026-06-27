import fs from "fs";
import path from "path";
import { parse as parseToml } from "smol-toml";

export function copyFile(sourcePath: string, destinationPath: string): void {
  const dest = path.resolve(destinationPath);
  if (fs.existsSync(dest)) {
    return;
  }
  fs.copyFileSync(path.resolve(sourcePath), dest);
}

export function loadToml(filepath: string): Record<string, unknown> {
  const content = fs.readFileSync(path.resolve(filepath), "utf-8");
  return parseToml(content) as Record<string, unknown>;
}

export function loadLines(filepath: string): string[] {
  const content = fs.readFileSync(path.resolve(filepath), "utf-8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function writeLines(filepath: string, lines: Iterable<string>): void {
  const arr = Array.from(lines);
  fs.writeFileSync(path.resolve(filepath), arr.join("\n"), "utf-8");
}

export function truncateFileAfterKeyword(
  filePath: string,
  keyword: string,
  offset: number = 0
): void {
  const p = path.resolve(filePath);
  if (!fs.existsSync(p)) {
    throw new Error(`${filePath} does not exist`);
  }
  const lines = fs.readFileSync(p, "utf-8").split(/\r?\n/);
  const cutoffIndex = lines.findIndex((line) => line.includes(keyword));
  if (cutoffIndex === -1) {
    return;
  }
  const trimmed = lines.slice(0, cutoffIndex + 1 + offset);
  fs.writeFileSync(p, trimmed.join("\n") + "\n", "utf-8");
}

export function createJson(filepath: string, data: unknown): void {
  fs.writeFileSync(
    path.resolve(filepath),
    JSON.stringify([data], null, 4),
    "utf-8"
  );
}

export function loadJson(filepath: string): Array<Record<string, unknown>> {
  const content = fs.readFileSync(path.resolve(filepath), "utf-8");
  return JSON.parse(content);
}

export function appendJson(filepath: string, newData: unknown): void {
  const p = path.resolve(filepath);
  if (!fs.existsSync(p)) {
    createJson(filepath, newData);
  } else {
    const data = loadJson(filepath);
    data.push(newData as Record<string, unknown>);
    fs.writeFileSync(p, JSON.stringify(data, null, 4) + "\n", "utf-8");
  }
}

export function deleteJson(
  filepath: string,
  key: string,
  value: string
): void {
  const records = loadJson(filepath).filter((record) => record[key] !== value);
  fs.writeFileSync(
    path.resolve(filepath),
    JSON.stringify(records, null, 4) + "\n",
    "utf-8"
  );
}

export function toJson(obj: unknown): string {
  return JSON.stringify(obj, null, 0);
}
