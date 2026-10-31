import { describe, expect, it } from "vitest";
import { extractLastChoiceLetter } from "../../src/speech/extractChoiceLetter";

describe("extractLastChoiceLetter", () => {
  it("returns null for empty / no letter", () => {
    expect(extractLastChoiceLetter("")).toBeNull();
    expect(extractLastChoiceLetter("我不知道")).toBeNull();
  });

  it("extracts bare A–D (case insensitive)", () => {
    expect(extractLastChoiceLetter("A")).toBe("A");
    expect(extractLastChoiceLetter("b")).toBe("B");
    expect(extractLastChoiceLetter("选 C")).toBe("C");
    expect(extractLastChoiceLetter("答案是D")).toBe("D");
  });

  it("takes the last letter when multiple appear", () => {
    expect(extractLastChoiceLetter("我选 A……不对，选 B")).toBe("B");
    expect(extractLastChoiceLetter("A B C")).toBe("C");
    expect(extractLastChoiceLetter("先说A再说D")).toBe("D");
  });

  it("accepts Chinese option words 甲乙丙丁 as A–D", () => {
    expect(extractLastChoiceLetter("选乙")).toBe("B");
    expect(extractLastChoiceLetter("甲然后丙")).toBe("C");
  });
});
