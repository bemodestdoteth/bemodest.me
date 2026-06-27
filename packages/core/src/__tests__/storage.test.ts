import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  copyFile,
  loadLines,
  writeLines,
  truncateFileAfterKeyword,
  createJson,
  loadJson,
  appendJson,
  deleteJson,
  toJson,
} from "../storage.js";

describe("storage", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("copyFile copies if dest does not exist", () => {
    const src = path.join(tmpDir, "src.txt");
    const dest = path.join(tmpDir, "dest.txt");
    fs.writeFileSync(src, "hello", "utf-8");
    copyFile(src, dest);
    expect(fs.readFileSync(dest, "utf-8")).toBe("hello");
  });

  it("copyFile skips if dest exists", () => {
    const src = path.join(tmpDir, "src.txt");
    const dest = path.join(tmpDir, "dest.txt");
    fs.writeFileSync(src, "hello", "utf-8");
    fs.writeFileSync(dest, "world", "utf-8");
    copyFile(src, dest);
    expect(fs.readFileSync(dest, "utf-8")).toBe("world");
  });

  it("loadLines loads non-empty lines", () => {
    const fp = path.join(tmpDir, "lines.txt");
    fs.writeFileSync(fp, "line1\n\nline2\n", "utf-8");
    expect(loadLines(fp)).toEqual(["line1", "line2"]);
  });

  it("writeLines writes lines", () => {
    const fp = path.join(tmpDir, "out.txt");
    writeLines(fp, ["a", "b", "c"]);
    expect(fs.readFileSync(fp, "utf-8")).toBe("a\nb\nc");
  });

  it("truncateFileAfterKeyword truncates", () => {
    const fp = path.join(tmpDir, "truncate.txt");
    fs.writeFileSync(fp, "line1\nline2\nKEYWORD\nline4\n", "utf-8");
    truncateFileAfterKeyword(fp, "KEYWORD");
    expect(fs.readFileSync(fp, "utf-8")).toBe("line1\nline2\nKEYWORD\n");
  });

  it("truncateFileAfterKeyword with offset", () => {
    const fp = path.join(tmpDir, "truncate.txt");
    fs.writeFileSync(fp, "line1\nline2\nKEYWORD\nline4\nline5\n", "utf-8");
    truncateFileAfterKeyword(fp, "KEYWORD", 1);
    expect(fs.readFileSync(fp, "utf-8")).toBe("line1\nline2\nKEYWORD\nline4\n");
  });

  it("truncateFileAfterKeyword no match leaves file unchanged", () => {
    const fp = path.join(tmpDir, "truncate.txt");
    fs.writeFileSync(fp, "line1\nline2\n", "utf-8");
    truncateFileAfterKeyword(fp, "MISSING");
    expect(fs.readFileSync(fp, "utf-8")).toBe("line1\nline2\n");
  });

  it("truncateFileAfterKeyword throws if file missing", () => {
    expect(() =>
      truncateFileAfterKeyword(path.join(tmpDir, "missing.txt"), "x")
    ).toThrow("does not exist");
  });

  it("createJson and loadJson", () => {
    const fp = path.join(tmpDir, "data.json");
    createJson(fp, { id: 1 });
    expect(loadJson(fp)).toEqual([{ id: 1 }]);
  });

  it("appendJson", () => {
    const fp = path.join(tmpDir, "data.json");
    createJson(fp, { id: 1 });
    appendJson(fp, { id: 2 });
    expect(loadJson(fp)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("appendJson creates file if missing", () => {
    const fp = path.join(tmpDir, "new.json");
    appendJson(fp, { id: 1 });
    expect(loadJson(fp)).toEqual([{ id: 1 }]);
  });

  it("deleteJson", () => {
    const fp = path.join(tmpDir, "data.json");
    createJson(fp, { id: 1, name: "a" });
    appendJson(fp, { id: 2, name: "b" });
    deleteJson(fp, "name", "a");
    expect(loadJson(fp)).toEqual([{ id: 2, name: "b" }]);
  });

  it("toJson serializes compactly", () => {
    expect(toJson({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
  });
});
