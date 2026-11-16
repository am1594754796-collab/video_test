import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCodes, parseNames, parseRateTitle, parseSubmission, validCode } from "../functions/_lib/validate.js";
import { livePage, ratePage } from "../functions/_lib/pages.js";
import { BOARDS } from "../functions/_lib/boards.js";
import { SLOT_COUNT } from "../functions/_lib/constants.js";

const sixCodes = ["1", "2", "3", "4", "5", "6"];
const sixNames = ["甲", "乙", "丙", "丁", "戊", "己"];
const threeNames = ["案一", "案二", "案三"];

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

test("parses three names for case board", () => {
  const parsed = parseNames(threeNames, 3);
  assert.deepEqual(parsed.names, threeNames);
});

test("parses display names", () => {
  const parsed = parseNames(sixNames);
  assert.deepEqual(parsed.names, sixNames);
});

test("rejects blank or duplicate names", () => {
  assert.match(parseNames(["", "乙", "丙", "丁", "戊", "己"]).error, /1–32/);
  assert.equal(parseNames(["同名", "同名", "丙", "丁", "戊", "己"]).error, "名称不能重复。");
});

test("parses rate title", () => {
  assert.equal(parseRateTitle("课堂评分").title, "课堂评分");
  assert.match(parseRateTitle("").error, /扫码页标题/);
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

test("main live board keeps six editors and separate qr", () => {
  assert.equal(SLOT_COUNT, 6);
  assert.equal(BOARDS.main.slotCount, 6);
  const slots = sixNames.map((name, i) => ({ slot: i + 1, name }));
  const live = livePage({ boardId: "main", cleared: false, slots, rateTitle: "课堂评分" });
  assert.match(live, /id="cards"/);
  assert.match(live, /src="\/qr"/);
  assert.match(live, /data-live-api="\/api\/live-scores"/);
  assert.match(live, /href="\/case"/);
  assert.match(live, /name="rate_title"/);
  assert.match(live, /保存配置/);
  assert.doesNotMatch(live, /admin_token|管理口令/);
});

test("case live board has three people and its own qr", () => {
  assert.equal(BOARDS.case.slotCount, 3);
  assert.equal(BOARDS.case.defaultTitle, "案例打分");
  const slots = threeNames.map((name, i) => ({ slot: i + 1, name }));
  const live = livePage({ boardId: "case", slots, rateTitle: "案例打分" });
  assert.match(live, /src="\/case\/qr"/);
  assert.match(live, /action="\/case\/codes"/);
  assert.match(live, /action="\/case\/scores\/clear"/);
  assert.match(live, /data-live-api="\/case\/api\/live-scores"/);
  assert.match(live, /href="\/"/);
  assert.match(live, /value="案例打分"/);
  for (let i = 1; i <= 3; i++) assert.match(live, new RegExp(`name="name${i}"`));
  assert.doesNotMatch(live, /name="name4"/);
});

test("shared rating page lists people with configurable title and no tip", () => {
  const slots = sixCodes.map((code, i) => ({ slot: i + 1, code, name: sixNames[i] }));
  const rate = ratePage({
    slots,
    scoredSlots: [1, 2],
    title: "课堂评分",
    notice: null,
    error: null,
  });
  assert.match(rate, /<h1>课堂评分<\/h1>/);
  assert.doesNotMatch(rate, /上下共/);
  assert.match(rate, /id="person-list"/);
  assert.match(rate, /\/static\/rate\.js/);
});
