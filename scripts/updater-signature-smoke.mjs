// verify-updater-signature.mjs against signatures made by `tauri signer sign --app-version` with a
// throwaway test key (scripts/fixtures/updater-signature; its private key was discarded).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyUpdaterSignature } from "./verify-updater-signature.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/updater-signature/${name}`, import.meta.url));
const data = fixture("installer.bin");
const pubkey = fixture("test-key.pub").toString("utf8").trim();
const good = fixture("good.sig").toString("utf8");
const releaseKey = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")).plugins.updater.pubkey;
const check = (overrides) => () => verifyUpdaterSignature({ data, signature: good, pubkey, version: "1.2.3", ...overrides });

assert.match(check({})(), /^timestamp:\d+\tfile:SLUI-Setup-1\.2\.3\.exe\tversion:1\.2\.3$/);
// A trailing newline on the .sig file is tolerated, like the published manifests' trimmed value.
assert.doesNotThrow(check({ signature: `${good}\n` }));

// The release key is not the test key: a mismatched secret fails before anything is published.
assert.throws(check({ pubkey: releaseKey }), /signed with key [0-9a-f]{16}, but tauri\.conf\.json's updater key is/);
const tampered = Buffer.from(data);
tampered[0] ^= 1;
assert.throws(check({ data: tampered }), /does not match the file/);
assert.throws(check({ signature: fixture("wrong-version.sig").toString("utf8") }), /signed version is 1\.2\.4, expected 1\.2\.3/);
assert.throws(check({ signature: fixture("wrong-file.sig").toString("utf8") }), /SLUI-Setup-1\.2\.3-theme-pack\.exe, SLUI requires SLUI-Setup-1\.2\.3\.exe/);
assert.throws(check({ version: "1.2.4" }), /SLUI requires SLUI-Setup-1\.2\.4\.exe/);

// The trusted comment is covered by the global signature; editing it breaks that, not the file check.
const decoded = Buffer.from(good.trim(), "base64").toString("utf8");
const editComment = (text) => Buffer.from(text).toString("base64");
assert.throws(check({ signature: editComment(decoded.replace("version:1.2.3", "version:1.2.9")) }), /global signature does not match/);
// The comment is read from the third line only (updater.rs signed_file_name); one moved into the
// untrusted first line is not a trusted comment.
const [untrusted, sigLine, comment, globalLine] = decoded.split("\n");
assert.throws(check({ signature: editComment([comment, sigLine, untrusted, globalLine].join("\n")) }), /third line is not the trusted comment/);
assert.throws(check({ signature: editComment(decoded.split("\n").slice(0, 3).join("\n")) }), /fewer than 4 lines/);
assert.throws(check({ signature: "not base64!" }), /not base64/);
assert.throws(check({ pubkey: "AAAA" }), /no key line|not UTF-8/);

console.log("updater signature smoke passed");
