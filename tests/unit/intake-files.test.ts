import { describe, it, expect } from "vitest";
import { safeName, encodeFileAnswer, parseFileAnswer, FILE_ANSWER_PREFIX, INTAKE_MIME, INTAKE_MAX_BYTES } from "../../lib/storage";

describe("safeName", () => {
  it("strips path separators (no traversal into the object key)", () => {
    expect(safeName("../../etc/passwd")).toBe("passwd");
    expect(safeName("a/b/c/room.png")).toBe("room.png");
    expect(safeName("x\\y\\shot.jpg")).toBe("shot.jpg");
  });
  it("neutralizes odd characters and collapses underscores", () => {
    expect(safeName("my photo (1)!.png")).toBe("my_photo_1_.png");
  });
  it("keeps dots, dashes, underscores; caps length", () => {
    expect(safeName("in-take_2024.pdf")).toBe("in-take_2024.pdf");
    expect(safeName("a".repeat(300) + ".png").length).toBeLessThanOrEqual(120);
  });
  it("never returns empty", () => {
    expect(safeName("")).toBe("file");
    expect(safeName("///")).toBe("file");
  });
});

describe("file-answer encode/parse", () => {
  it("round-trips path + name", () => {
    const enc = encodeFileAnswer("coastal-cuts/uuid-1/room.png", "room.png");
    expect(enc.startsWith(FILE_ANSWER_PREFIX)).toBe(true);
    expect(parseFileAnswer(enc)).toEqual({ path: "coastal-cuts/uuid-1/room.png", name: "room.png" });
  });
  it("uses the LAST '::' so names containing ':' survive", () => {
    const enc = encodeFileAnswer("slug/u/weird::name.png", "weird::name.png");
    // name split on the last '::' — path is everything before it
    const p = parseFileAnswer(enc)!;
    expect(p.name).toBe("name.png");
  });
  it("returns null for a plain-text answer (not a file)", () => {
    expect(parseFileAnswer("Honda Civic 2019")).toBeNull();
    expect(parseFileAnswer("file:missing-double-colon")).toBeNull();
  });
  it("returns null for a malformed file marker with no path", () => {
    expect(parseFileAnswer("file::")).toBeNull();
  });
});

describe("limits", () => {
  it("allows images + pdf only", () => {
    expect(INTAKE_MIME.has("image/png")).toBe(true);
    expect(INTAKE_MIME.has("application/pdf")).toBe(true);
    expect(INTAKE_MIME.has("text/html")).toBe(false);
    expect(INTAKE_MIME.has("application/octet-stream")).toBe(false);
  });
  it("caps at 10MB", () => expect(INTAKE_MAX_BYTES).toBe(10 * 1024 * 1024));
});
