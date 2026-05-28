import { expect, test } from "vitest";

import { verifiedFeedFields, VerifyFeedResult } from "./settings";

test("replaces the pasted URL with stream_url and prefills code for a new feed", () => {
  const res: VerifyFeedResult = {
    ok: true, stream_url: "http://audio.liveatc.net/vhhh5", suggested_code: "VHHH",
  };
  expect(verifiedFeedFields(res, false)).toEqual({
    url: "http://audio.liveatc.net/vhhh5", airport_code: "VHHH",
  });
});

test("rewrites the URL but leaves code alone for a persisted feed", () => {
  const res: VerifyFeedResult = {
    ok: true, stream_url: "http://audio.liveatc.net/vhhh5", suggested_code: "VHHH",
  };
  expect(verifiedFeedFields(res, true)).toEqual({ url: "http://audio.liveatc.net/vhhh5" });
});

test("leaves the URL unchanged when verification fails", () => {
  const res: VerifyFeedResult = { ok: false, stream_url: null, reason: "Unreachable" };
  expect(verifiedFeedFields(res, false)).toEqual({});
});
