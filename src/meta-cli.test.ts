import { test, expect } from "bun:test";
import { unwrapArray } from "./meta-cli.ts";

test("unwrapArray: bare array passes through", () => {
  expect(unwrapArray([1, 2, 3])).toEqual([1, 2, 3]);
});

test("unwrapArray: {data: [...]} envelope unwraps", () => {
  expect(unwrapArray({ data: [{ id: "a" }, { id: "b" }] })).toEqual([
    { id: "a" },
    { id: "b" },
  ]);
});

test("unwrapArray: null → []", () => {
  expect(unwrapArray(null)).toEqual([]);
});

test("unwrapArray: undefined → []", () => {
  expect(unwrapArray(undefined)).toEqual([]);
});

test("unwrapArray: plain object without data → []", () => {
  expect(unwrapArray({ id: "1", name: "x" })).toEqual([]);
});

test("unwrapArray: {data: <non-array>} → []", () => {
  expect(unwrapArray({ data: { id: "1" } })).toEqual([]);
  expect(unwrapArray({ data: "string" })).toEqual([]);
  expect(unwrapArray({ data: null })).toEqual([]);
});

test("unwrapArray: empty array passes through", () => {
  expect(unwrapArray([])).toEqual([]);
});

test("unwrapArray: empty data array passes through", () => {
  expect(unwrapArray({ data: [] })).toEqual([]);
});

test("unwrapArray: primitive values → []", () => {
  expect(unwrapArray("string")).toEqual([]);
  expect(unwrapArray(42)).toEqual([]);
  expect(unwrapArray(true)).toEqual([]);
});

test("unwrapArray: preserves row reference identity", () => {
  const row = { id: "1" };
  const result = unwrapArray<{ id: string }>({ data: [row] });
  expect(result[0]).toBe(row);
});
