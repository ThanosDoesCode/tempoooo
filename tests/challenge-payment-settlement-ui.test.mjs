import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Money totals keep an awaiting-confirmation obligation visible and unsettled", async () => {
  const money = await read("src/routes/_authenticated/challenge/money.tsx");
  // "Open" (and therefore the owe/owed totals) include everything that is not yet confirmed_paid,
  // so a marked_paid obligation never disappears or reads as settled before the recipient confirms.
  assert.match(money, /const open = rows\.filter\(\(p\) => p\.status !== "confirmed_paid"\)/);
  assert.match(money, /const settled = rows\.filter\(\(p\) => p\.status === "confirmed_paid"\)/);
  assert.match(money, /iOwe[\s\S]*\.filter\(\(p\) => p\.payer_id === user\?\.id\)/);
  assert.match(money, /owedToMe[\s\S]*\.filter\(\(p\) => p\.recipient_id === user\?\.id\)/);
});

test("payer mark-paid sets only marked_paid; recipient gets Got it and Not received", async () => {
  const money = await read("src/routes/_authenticated/challenge/money.tsx");
  // Payer actions never reach confirmed_paid.
  assert.match(money, /onMarkPaid=\{\(\) => void setStatus\(p\.id, "marked_paid"\)\}/);
  // The payer's only buttons are mark-paid and undo; a confirm button renders solely for !mine.
  assert.match(money, /\{mine && payment\.status === "unpaid"[\s\S]*?onClick=\{onMarkPaid\}/);
  assert.match(money, /\{!mine && payment\.status === "marked_paid"[\s\S]*?onClick=\{onConfirm\}/);
  // Recipient confirmation + rejection.
  assert.match(money, /onConfirm=\{\(\) => void setStatus\(p\.id, "confirmed_paid"\)\}/);
  assert.match(money, /onReject=\{\(\) => void setStatus\(p\.id, "unpaid"\)\}/);
  assert.match(money, /Not received/);
  assert.match(money, /Got it/);
  // Payer awaiting-confirmation copy; obligation stays visible.
  assert.match(money, /Waiting for \$\{name\(payment\.recipient_id\)\} to confirm\./);
  assert.match(money, /says this was paid/);
});

test("the payer self-settle helper is gone", async () => {
  const challenge = await read("src/lib/challenge.ts");
  assert.doesNotMatch(challenge, /settleMyDebts/);
});
