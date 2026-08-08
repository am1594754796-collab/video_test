import { describe, expect, it } from "vitest";
import { RaiseDebouncer } from "../../src/vision/detect/raiseDebouncer";

describe("RaiseDebouncer", () => {
  it("stays false until minFrames consecutive raised observations", () => {
    const d = new RaiseDebouncer({ minFrames: 3 });
    expect(d.update(true)).toBe(false);
    expect(d.update(true)).toBe(false);
    expect(d.update(true)).toBe(true);
    expect(d.raised).toBe(true);
  });

  it("does not flip on a single-frame spike", () => {
    const d = new RaiseDebouncer({ minFrames: 3 });
    expect(d.update(true)).toBe(false);
    expect(d.update(false)).toBe(false);
    expect(d.update(true)).toBe(false);
    expect(d.raised).toBe(false);
  });

  it("requires consecutive downs to clear raised state", () => {
    const d = new RaiseDebouncer({ minFrames: 2 });
    d.update(true);
    d.update(true);
    expect(d.raised).toBe(true);
    expect(d.update(false)).toBe(true);
    expect(d.update(false)).toBe(false);
  });

  it("reset clears state", () => {
    const d = new RaiseDebouncer({ minFrames: 2 });
    d.update(true);
    d.update(true);
    d.reset();
    expect(d.raised).toBe(false);
    expect(d.update(true)).toBe(false);
  });
});
