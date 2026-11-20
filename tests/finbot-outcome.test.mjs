// Does every shape of Finbot reply get classified so that a retry can only
// ever follow a reply that PROVES no document was created?
//
// HOW TO RUN
//   node tests/finbot-outcome.test.mjs
//
// The module is pure; esbuild is used only to resolve the "@/" alias.
//
// WHAT IT PROVES
//   The one dangerous mistake is calling an unknown outcome a failure, because
//   'failed' licenses a retry and a retry of a request that actually succeeded
//   issues a SECOND tax document. So the test is adversarial in one direction:
//   for every ambiguous reply it asserts the answer is NOT 'failed'.
import { build } from "esbuild";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(mkdtempSync(join(tmpdir(), "fbo-")), "b.mjs");
const entry = join(dirname(out), "e.mjs");
writeFileSync(entry, `export * from "${resolve(REPO, "src/lib/finbotOutcome.js")}";`);
await build({ entryPoints: [entry], outfile: out, bundle: true, format: "esm",
  platform: "node", alias: { "@": resolve(REPO, "src") } });
const M = await import(out);

let pass = 0, fail = 0;
const check = (n, c, d = "") => {
  c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}  ${d}`));
};
const kind = (reply) => M.classifyFinbotOutcome(reply).kind;

console.log("\n1. CONFIRMED — and only with a document number");
{
  const r = M.classifyFinbotOutcome({ data: { ok: true, invoiceNumber: "20200", pdfUrl: "https://x.test/a.pdf" } });
  check("accepted with a number is confirmed", r.kind === "confirmed", r.kind);
  check("the number is carried", r.number === "20200");
  check("and the pdf url", r.url === "https://x.test/a.pdf");

  check("a numeric document number works too",
    M.classifyFinbotOutcome({ data: { ok: true, invoiceNumber: 20201 } }).number === "20201");
  check("surrounding whitespace is trimmed",
    M.classifyFinbotOutcome({ data: { ok: true, invoiceNumber: "  20202 " } }).number === "20202");
  check("no pdf url is null, not empty string",
    M.classifyFinbotOutcome({ data: { ok: true, invoiceNumber: "1" } }).url === null);

  // ACCEPTED BUT UNNAMEABLE. The tempting reading is "it worked"; the safe one
  // is that we cannot claim a document we cannot name, and must not re-send.
  for (const bad of [undefined, null, "", "   "]) {
    const x = M.classifyFinbotOutcome({ data: { ok: true, invoiceNumber: bad } });
    check(`ok:true with ${JSON.stringify(bad)} as the number is UNCERTAIN`,
      x.kind === "uncertain", x.kind);
    check("  and never confirmed", x.number === null);
  }
}

console.log("\n2. FAILED — only replies that prove nothing was created");
{
  // A bare "fetch failed" names nothing about WHEN it failed, so it cannot be
  // a proven failure. Sections 7 and 8 take this apart properly.
  let r = M.classifyFinbotOutcome({ data: { ok: false, error: "Finbot request failed: fetch failed" } });
  check("an unqualified fetch rejection is uncertain, not failed",
    r.kind === "uncertain", r.kind);
  r = M.classifyFinbotOutcome({ data: { ok: false, error: "Finbot request failed: error trying to connect: tcp connect error" } });
  check("a connection that was never made IS a failure", r.kind === "failed", r.kind);
  check("  reason recorded", r.reason === "proven_never_sent", r.reason);

  // 409 is excluded: see section 11.
  for (const s of [400, 401, 403, 404, 422, 499]) {
    check(`HTTP ${s} is a verdict: failed`,
      kind({ data: { ok: false, error: `Finbot HTTP ${s}: bad request` } }) === "failed");
  }

  r = M.classifyFinbotOutcome({ data: { ok: false, status: 0, error: "סכום הפריטים אינו תואם לסכום התקבולים" } });
  check("a business error (status != 1) is failed", r.kind === "failed", r.kind);
  check("  with the provider text kept", /סכום הפריטים/.test(r.error || ""), r.error);
  check("status 2 is also a business refusal",
    kind({ data: { ok: false, status: 2, error: "x" } }) === "failed");
}

console.log("\n3. UNCERTAIN — everything ambiguous, without exception");
{
  const ambiguous = [
    ["the invoke call itself rejected", { invokeError: new Error("Failed to fetch") }],
    ["an invoke rejection with no message", { invokeError: {} }],
    ["no data at all", { data: null }],
    ["undefined data", { data: undefined }],
    ["a non-object body", { data: "oops" }],
    ["HTTP 500", { data: { ok: false, error: "Finbot HTTP 500: boom" } }],
    ["HTTP 502", { data: { ok: false, error: "Finbot HTTP 502: gateway" } }],
    ["HTTP 503", { data: { ok: false, error: "Finbot HTTP 503: unavailable" } }],
    ["HTTP 504 (a timeout at the gateway)", { data: { ok: false, error: "Finbot HTTP 504: timeout" } }],
    ["an unparseable 2xx body", { data: { ok: false, error: "Finbot returned invalid JSON" } }],
    ["ok:false with no error text at all", { data: { ok: false } }],
    ["an empty object", { data: {} }],
    ["an unrecognised shape", { data: { ok: false, error: "something new" } }],
    ["ok:false with status 1, which makes no sense", { data: { ok: false, status: 1, error: "?" } }],
  ];
  for (const [label, reply] of ambiguous) {
    const k = kind(reply);
    check(`${label} -> uncertain`, k === "uncertain", k);
  }

  // THE PROPERTY THAT MATTERS, stated as such: nothing ambiguous may be
  // 'failed', because 'failed' is what unlocks a retry.
  const wronglyFailed = ambiguous.filter(([, reply]) => kind(reply) === "failed");
  check("NOT ONE ambiguous reply is classified as failed",
    wronglyFailed.length === 0, wronglyFailed.map(([l]) => l).join(", "));

  // And nothing ambiguous is confirmed either.
  const wronglyConfirmed = ambiguous.filter(([, reply]) => kind(reply) === "confirmed");
  check("nor as confirmed", wronglyConfirmed.length === 0,
    wronglyConfirmed.map(([l]) => l).join(", "));
}

console.log("\n4. NO INPUT IS A CRASH");
{
  for (const reply of [undefined, {}, { data: 0 }, { data: false }, { data: [] },
                       { invokeError: null, data: null }]) {
    let k;
    try { k = kind(reply); } catch (e) { k = `THREW ${e.message}`; }
    check(`${JSON.stringify(reply)} is handled`, k === "uncertain", k);
  }
}

console.log("\n5. WHAT MAY BE SENT TO FINBOT");
{
  check("a fresh credit note may be sent", M.maySendToFinbot("pending") === true);
  check("an unclassified legacy row may be sent", M.maySendToFinbot(null) === true
    && M.maySendToFinbot(undefined) === true);
  check("a definite failure may be retried", M.maySendToFinbot("failed") === true);

  // The two that must never be sent again.
  check("an UNCERTAIN credit note may NOT be sent", M.maySendToFinbot("uncertain") === false);
  check("a confirmed one may not either", M.maySendToFinbot("confirmed") === false);
  check("and nor may an unknown state", M.maySendToFinbot("whatever") === false);
}

console.log("\n6. THE WHOLE ROUND TRIP, FOR EACH OUTCOME");
{
  // Exactly what the component does with each classification: confirm, or
  // resolve with that status and NO evidence — because this is the first
  // finding about the attempt, not a person resolving one.
  const plan = (reply, statusBefore = "pending") => {
    if (!M.maySendToFinbot(statusBefore)) return { call: "none", reason: "must_not_send" };
    const o = M.classifyFinbotOutcome(reply);
    if (o.kind === "confirmed") {
      return { call: "credit_note_confirm", number: o.number, source: "api" };
    }
    return { call: "credit_note_resolve", status: o.kind, evidence: null };
  };

  let p = plan({ data: { ok: true, invoiceNumber: "20300" } });
  check("success -> confirm with the number and source api",
    p.call === "credit_note_confirm" && p.number === "20300" && p.source === "api",
    JSON.stringify(p));

  p = plan({ data: { ok: false, error: "Finbot HTTP 400: nope" } });
  check("refusal -> resolve as failed", p.call === "credit_note_resolve"
    && p.status === "failed", JSON.stringify(p));
  check("  with no evidence — a person supplies that later", p.evidence === null);

  p = plan({ data: { ok: false, error: "Finbot HTTP 503: unavailable" } });
  check("unknown -> resolve as uncertain", p.call === "credit_note_resolve"
    && p.status === "uncertain", JSON.stringify(p));

  p = plan({ data: { ok: true, invoiceNumber: "20301" } }, "uncertain");
  check("an uncertain credit note is NOT SENT AT ALL, whatever would come back",
    p.call === "none" && p.reason === "must_not_send", JSON.stringify(p));
  p = plan({ data: { ok: true, invoiceNumber: "20302" } }, "confirmed");
  check("nor is a confirmed one", p.call === "none", JSON.stringify(p));
}


// ============================================================================
// THE SAFETY AUDIT. "Finbot request failed" is produced by a BARE CATCH around
// fetch in supabase/functions/finbot-invoice/index.ts:
//
//     try { res = await fetch(FINBOT_URL, {...}); }
//     catch (err) { return json({ok:false, error:`Finbot request failed: ...`}); }
//
// One message, two events: a connection that was never established, and a
// socket that died with the request already delivered. Only the first proves
// no document was created, and only the first may unlock a retry.
// ============================================================================
console.log("\n7. AUDIT — failure BEFORE sending is the only proven failure");
{
  // Events that necessarily precede any transmission.
  const beforeSending = [
    "Finbot request failed: error trying to connect: tcp connect error: Connection refused (os error 61)",
    "Finbot request failed: error trying to connect: dns error: failed to lookup address information: nodename nor servname provided",
    "Finbot request failed: getaddrinfo ENOTFOUND api.finbotai.co.il",
    "Finbot request failed: connect ECONNREFUSED 10.0.0.1:443",
    "Finbot request failed: error trying to connect: invalid peer certificate: UnknownIssuer",
    "Finbot request failed: certificate verify failed",
    "Finbot request failed: Name or service not known",
    "Finbot request failed: unknown scheme for http client",
    "Finbot request failed: Invalid URL",
  ];
  for (const error of beforeSending) {
    const r = M.classifyFinbotOutcome({ data: { ok: false, error } });
    check(`never sent -> failed: ${error.slice(24, 64)}`, r.kind === "failed", r.kind);
    check("  and the reason says so", r.reason === "proven_never_sent", r.reason);
  }
}

console.log("\n8. AUDIT — the connection lost AFTER sending is NOT a failure");
{
  // Every one of these can occur with the request already delivered and
  // processed. The old classifier called them all 'failed'.
  const afterSending = [
    ["connection closed before the reply came back",
     "Finbot request failed: error sending request for url (https://api.finbotai.co.il/income): connection closed before message completed"],
    ["the socket was reset mid-exchange",
     "Finbot request failed: error sending request: connection reset by peer (os error 54)"],
    ["ECONNRESET", "Finbot request failed: read ECONNRESET"],
    ["the peer hung up", "Finbot request failed: socket hang up"],
    ["the stream was terminated", "Finbot request failed: terminated"],
    ["the body could not be read back",
     "Finbot request failed: error reading a body from connection"],
    ["the request was aborted", "Finbot request failed: The operation was aborted"],
    ["an unrecognised network message",
     "Finbot request failed: something nobody has seen before"],
    ["no message at all", "Finbot request failed: "],
  ];
  for (const [label, error] of afterSending) {
    const r = M.classifyFinbotOutcome({ data: { ok: false, error } });
    check(`${label} -> uncertain`, r.kind === "uncertain", r.kind);
  }
  const wrong = afterSending.filter(([, error]) =>
    M.classifyFinbotOutcome({ data: { ok: false, error } }).kind === "failed");
  check("NOT ONE of them is classified as failed", wrong.length === 0,
    wrong.map(([l]) => l).join(", "));
  // And none of them may be retried.
  check("so none of them permits a re-send",
    afterSending.every(([, error]) =>
      M.maySendToFinbot(M.classifyFinbotOutcome({ data: { ok: false, error } }).kind) === false));
}

console.log("\n9. AUDIT — timeouts after sending");
{
  // A timeout is the clearest case of all: the request went out and no answer
  // came back. The document may exist. The edge function sets no timeout of its
  // own, so these arrive from the platform or the runtime, by several wordings.
  const timeouts = [
    "Finbot request failed: operation timed out",
    "Finbot request failed: error sending request: operation timed out",
    "Finbot request failed: connect ETIMEDOUT 185.0.0.1:443",
    "Finbot request failed: request timed out after 30000ms",
    "Finbot request failed: TimeoutError: signal timed out",
    "Finbot HTTP 504: gateway timeout",
    "Finbot HTTP 408: request timeout",
  ];
  for (const error of timeouts) {
    const r = M.classifyFinbotOutcome({ data: { ok: false, error } });
    // EVERY timeout is uncertain, including the one that arrives as a status
    // code. See section 11a.
    check(`${error.slice(0, 52)} -> uncertain`, r.kind === "uncertain", r.kind);
  }
  check("not one timeout, in any wording, is a failure",
    timeouts.every(e =>
      M.classifyFinbotOutcome({ data: { ok: false, error: e } }).kind === "uncertain"));

  // A timeout while the supabase client was calling the edge function is the
  // same shape one level up.
  check("a timeout talking to the edge function is uncertain too",
    M.classifyFinbotOutcome({ invokeError: new Error("signal timed out") }).kind === "uncertain");
  check("and an aborted invoke",
    M.classifyFinbotOutcome({ invokeError: new Error("AbortError: aborted") })
      .kind === "uncertain");
}

console.log("\n10. AUDIT — a response with no document number");
{
  // Finbot said yes and did not name the document. The document very likely
  // EXISTS; what is missing is our ability to reference it. Re-sending would
  // create a second one.
  for (const data of [
    { ok: true },
    { ok: true, invoiceNumber: null },
    { ok: true, invoiceNumber: "" },
    { ok: true, invoiceNumber: "   " },
    { ok: true, pdfUrl: "https://x.test/doc.pdf" },      // a PDF but no number
    { ok: true, invoiceNumber: undefined, pdfUrl: null },
  ]) {
    const r = M.classifyFinbotOutcome({ data });
    check(`${JSON.stringify(data)} -> uncertain`, r.kind === "uncertain", r.kind);
    check("  nothing is confirmed", r.number === null);
    check("  and it may not be re-sent", M.maySendToFinbot(r.kind) === false);
  }
  // The provider answering status:1 — its success code — with no number is the
  // same situation.
  check("status 1 with no number is uncertain, not failed",
    M.classifyFinbotOutcome({ data: { ok: false, status: 1, error: "" } }).kind === "uncertain");
}

console.log("\n11. AUDIT — the two 4xx codes that are NOT verdicts");
{
  // 408 Request Timeout. The server gave up waiting for the request — and says
  // nothing about how much of it had already arrived and been handed on. A
  // gateway can emit 408 with the body fully received, so "Finbot never
  // processed it" is not provable, and only proof may unlock a retry.
  for (const e of ["Finbot HTTP 408: request timeout",
                   "Finbot HTTP 408: Request Time-out",
                   "Finbot HTTP 408: ",
                   "Finbot HTTP 408: <html>408 Request Timeout</html>"]) {
    const r = M.classifyFinbotOutcome({ data: { ok: false, error: e } });
    check(`408 is uncertain: ${e.slice(12, 44)}`, r.kind === "uncertain", r.kind);
    check("  with a reason that says why",
      r.reason === "request_timeout_not_a_verdict", r.reason);
    check("  and it may not be re-sent", M.maySendToFinbot(r.kind) === false);
  }

  // 409 Conflict can mean the document ALREADY EXISTS.
  const c = M.classifyFinbotOutcome({ data: { ok: false, error: "Finbot HTTP 409: document already exists" } });
  check("409 is uncertain, not failed", c.kind === "uncertain", c.kind);
  check("  for its own reason", c.reason === "conflict_may_already_exist", c.reason);

  check("while 400, 401, 403, 404, 422, 429 stay failed",
    [400, 401, 403, 404, 422, 429].every(s =>
      M.classifyFinbotOutcome({ data: { ok: false, error: `Finbot HTTP ${s}: no` } }).kind === "failed"));

  // THE RULE OVER THE WHOLE 4xx RANGE, swept rather than sampled.
  const retryable4xx = [];
  for (let s = 400; s < 500; s += 1) {
    if (M.classifyFinbotOutcome({ data: { ok: false, error: `Finbot HTTP ${s}: x` } })
        .kind === "failed") retryable4xx.push(s);
  }
  check("408 and 409 are the only 4xx codes excluded from being verdicts",
    !retryable4xx.includes(408) && !retryable4xx.includes(409)
    && retryable4xx.length === 98, `${retryable4xx.length} retryable`);
}

console.log("\n12. THE PROPERTY, STATED ONCE OVER EVERYTHING ABOVE");
{
  // Only three kinds of reply may ever unlock a retry: a 4xx verdict other
  // than 409, a business refusal, and a connection that was never made.
  const everyReply = [
    { data: { ok: true, invoiceNumber: "1" } },
    { data: { ok: true } },
    { data: { ok: false, error: "Finbot HTTP 400: x" } },
    { data: { ok: false, error: "Finbot HTTP 408: x" } },
    { data: { ok: false, error: "Finbot HTTP 409: x" } },
    { data: { ok: false, error: "Finbot HTTP 500: x" } },
    { data: { ok: false, error: "Finbot HTTP 504: x" } },
    { data: { ok: false, error: "Finbot returned invalid JSON" } },
    { data: { ok: false, status: 0, error: "refused" } },
    { data: { ok: false, error: "Finbot request failed: connection refused" } },
    { data: { ok: false, error: "Finbot request failed: connection reset by peer" } },
    { data: { ok: false, error: "Finbot request failed: operation timed out" } },
    { data: { ok: false, error: "Finbot request failed: connection closed before message completed" } },
    { data: {} }, { data: null }, { invokeError: new Error("Failed to fetch") },
  ];
  const retryable = everyReply
    .map(r => ({ r, o: M.classifyFinbotOutcome(r) }))
    .filter(({ o }) => M.maySendToFinbot(o.kind));
  check("exactly three replies permit a retry", retryable.length === 3,
    retryable.map(({ o }) => o.reason).join(", "));
  check("and each of them proves no document was created",
    retryable.every(({ o }) =>
      ["refused_4xx", "business_error", "proven_never_sent"].includes(o.reason)),
    retryable.map(({ o }) => o.reason).join(", "));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
