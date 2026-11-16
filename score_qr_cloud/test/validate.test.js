import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCodes, parseNames, parseSubmission, validCode } from "../functions/_lib/validate.js";
import { livePage, ratePage } from "../functions/_lib/pages.js";
import { SLOT_COUNT } from "../functions/_lib/constants.js";

const sixCodes = ["1", "2", "3", "4", "5", "6"];
const sixNames = ["甲", "乙", "丙", "丁", "戊", "己"];

test("accepts six unique codes including unicode", () => {
  const parsed = parseCodes(["甲", "乙", "丙", "丁", "戊", "己"]);
  assert.deepEqual(parsed.codes, ["甲", "乙", "丙", "丁", "戊", "己"]);
});

test("rejects duplicate codes", () => {
  const parsed = parseCodes(["1", "1", "3", "4", "5", "6"]);
  assert.equal(parsed.error, "编号不能重复。");
});

test("rejects wrong slot count", () => {
  const parsed = parseCodes(["1", "2"]);
  assert.match(parsed.error, /正好 6/);
});

test("parses display names", () => {
  const parsed = parseNames(sixNames);
  assert.deepEqual(parsed.names, sixNames);
});

test("rejects blank or duplicate names", () => {
  assert.match(parseNames(["", "乙", "丙", "丁", "戊", "己"]).error, /1–32/);
  assert.equal(parseNames(["同名", "同名", "丙", "丁", "戊", "己"]).error, "名称不能重复。");
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

test("live board keeps shared QR, six name editors, and clear control", () => {
  assert.equal(SLOT_COUNT, 6);
  const slots = sixNames.map((name, i) => ({ slot: i + 1, name }));
  const live = livePage({ cleared: false, slots });
  assert.match(live, /id="cards"/);
  assert.match(live, /src="\/qr"/);
  for (let i = 1; i <= 6; i++) assert.match(live, new RegExp(`name="name${i}"`));
  assert.match(live, /value="甲"/);
  assert.match(live, /保存名称/);
  assert.match(live, /清空全部评分/);
  assert.doesNotMatch(live, /admin_token|管理口令/);
});

test("shared rating page lists six people with own score inputs", () => {
  const slots = sixCodes.map((code, i) => ({ slot: i + 1, code, name: sixNames[i] }));
  const rate = ratePage({
    slots,
    scoredSlots: [1, 2],
    notice: null,
    error: null,
  });
  assert.match(rate, /每人单独打分提交/);
  assert.match(rate, /id="person-list"/);
  assert.match(rate, /已提交，不能再次评分/);
  assert.match(rate, /name="score"/);
  assert.match(rate, /\/static\/rate\.js/);
  for (let i = 3; i <= 6; i++) {
    assert.match(rate, new RegExp(`name="slot" value="${i}"`));
    assert.match(rate, new RegExp(`id="score-${i}"`));
  }
  assert.doesNotMatch(rate, /name="slot" value="1"/);
  assert.doesNotMatch(rate, /name="slot" value="2"/);
  for (const name of sixNames) assert.match(rate, new RegExp(name));
});
