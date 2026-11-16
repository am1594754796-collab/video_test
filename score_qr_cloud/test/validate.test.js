import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCodes, parseNames, parseSubmission, validCode } from "../functions/_lib/validate.js";
import { livePage, ratePage } from "../functions/_lib/pages.js";
import { SLOT_COUNT } from "../functions/_lib/constants.js";

test("accepts two unique codes including unicode", () => {
  const parsed = parseCodes(["甲", "乙"]);
  assert.deepEqual(parsed.codes, ["甲", "乙"]);
});

test("rejects duplicate codes", () => {
  const parsed = parseCodes(["1", "1"]);
  assert.equal(parsed.error, "编号不能重复。");
});

test("rejects wrong slot count", () => {
  const parsed = parseCodes(["1", "2", "3"]);
  assert.match(parsed.error, /正好 2/);
});

test("parses display names", () => {
  const parsed = parseNames(["张三", "李四"]);
  assert.deepEqual(parsed.names, ["张三", "李四"]);
});

test("rejects blank or duplicate names", () => {
  assert.match(parseNames(["", "李四"]).error, /1–32/);
  assert.equal(parseNames(["同名", "同名"]).error, "名称不能重复。");
});

test("parses valid score", () => {
  const parsed = parseSubmission({ get: (k) => ({ score: "40", comment: "ok" })[k] });
  assert.equal(parsed.score, 40);
  assert.equal(parsed.comment, "ok");
});

test("rejects out of range score", () => {
  const parsed = parseSubmission({ get: (k) => ({ score: "101", comment: "" })[k] });
  assert.match(parsed.error, /0 到 100/);
});

test("validCode matches length rules", () => {
  assert.equal(validCode("1"), true);
  assert.equal(validCode("a_b-1"), true);
  assert.equal(validCode(""), false);
});

test("live board keeps shared QR, name editors, and clear control", () => {
  assert.equal(SLOT_COUNT, 2);
  const live = livePage({
    cleared: false,
    slots: [
      { slot: 1, name: "张三" },
      { slot: 2, name: "李四" },
    ],
  });
  assert.match(live, /id="cards"/);
  assert.match(live, /src="\/qr"/);
  assert.match(live, /name="name1"/);
  assert.match(live, /name="name2"/);
  assert.match(live, /value="张三"/);
  assert.match(live, /保存名称/);
  assert.match(live, /清空全部评分/);
  assert.doesNotMatch(live, /admin_token|管理口令/);
});

test("shared rating page shows configured names", () => {
  const slots = [
    { slot: 1, code: "1", name: "张三" },
    { slot: 2, code: "2", name: "李四" },
  ];
  const rate = ratePage({ slots, selectedSlot: "", selectedScore: "", error: null, lockedSlot: null });
  assert.match(rate, /选择给谁打分/);
  assert.match(rate, /张三/);
  assert.match(rate, /李四/);
});
