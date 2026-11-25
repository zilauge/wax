import assert from "node:assert/strict";
import test from "node:test";
import { toMatchQuery } from "../app/lib/search/query.ts";

test("every token is quoted and prefix matched", () => {
  assert.equal(toMatchQuery("inv"), '"inv"*');
  assert.equal(toMatchQuery("invoice paid"), '"invoice"* AND "paid"*');
});

test("FTS operators cannot be injected through a search", () => {
  assert.equal(toMatchQuery('foo" OR "bar'), '"foo"* AND "OR"* AND "bar"*');
  assert.equal(toMatchQuery("body:secret"), '"bodysecret"*');
  assert.equal(toMatchQuery("(a OR b)"), '"a"* AND "OR"* AND "b"*');
  assert.equal(toMatchQuery("ne*ar^"), '"near"*');
});

test("blank and punctuation-only queries match nothing", () => {
  assert.equal(toMatchQuery(""), "");
  assert.equal(toMatchQuery("   "), "");
  assert.equal(toMatchQuery('"*^:()'), "");
});

test("a query is capped at eight tokens", () => {
  const query = toMatchQuery("one two three four five six seven eight nine ten");
  assert.equal(query.split(" AND ").length, 8);
  assert.ok(!query.includes("nine"));
});
