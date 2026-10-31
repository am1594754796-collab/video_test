import { describe, expect, it } from "vitest";
import { expectedChoiceLetter } from "../../src/speech/expectedChoiceLetter";

describe("expectedChoiceLetter", () => {
  const q = {
    id: "Q1",
    answer: "北京",
    options: { A: "上海", B: "北京", C: "广州", D: "深圳" },
  };

  it("maps answer text to matching option letter", () => {
    expect(expectedChoiceLetter(q)).toBe("B");
  });

  it("accepts answer that is already a letter", () => {
    expect(expectedChoiceLetter({ answer: "C", options: q.options })).toBe("C");
    expect(expectedChoiceLetter({ answer: "a", options: q.options })).toBe("A");
  });

  it("returns null when answer cannot be mapped", () => {
    expect(expectedChoiceLetter({ answer: "天津", options: q.options })).toBeNull();
    expect(expectedChoiceLetter({ answer: "北京" })).toBeNull();
  });
});
