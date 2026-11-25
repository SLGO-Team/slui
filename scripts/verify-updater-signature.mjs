// Verifies an installer's updater signature the way an installed SLUI does before it runs an update,
// so release.yml cannot publish a release that every client would reject (`failed { signature }`):
// - minisign (minisign-verify, as tauri-plugin-updater calls it): the signature's key id is the one in
//   `plugins.updater.pubkey` of src-tauri/tauri.conf.json, the Ed25519 signature covers the file
//   (BLAKE2b-512 prehashed for `ED`, raw for legacy `Ed`), and the global signature covers the
//   trusted comment;
// - the trusted comment (the decoded file's third line, where updater.rs `signed_file_name` reads it)
//   names `file:SLUI-Setup-<version>.exe` and `version:<version>` (`requireSignedVersion`).
// Built-in modules only: the signing job installs dependencies without running their scripts.
// Usage: node scripts/verify-updater-signature.mjs <SLUI-Setup-X.Y.Z.exe> <SLUI-Setup-X.Y.Z.exe.sig> <X.Y.Z>
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const TRUSTED_PREFIX = "trusted comment: ";

const fail = (message) => {
  throw new Error(message);
};

// Strict base64 (ct-codecs in minisign-verify rejects whitespace and bad padding; Buffer would skip them).
function decodeBase64(text, what) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) fail(`${what} is not base64`);
  const bytes = Buffer.from(text, "base64");
  if (bytes.toString("base64") !== text) fail(`${what} is not canonical base64`);
  return bytes;
}

// Rust's str::lines: split on \n, drop one trailing \r per line, no final empty line.
function lines(text) {
  const parts = text.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

const utf8 = (bytes, what) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail(`${what} is not UTF-8`);
  }
};

/** `plugins.updater.pubkey`: base64 of a minisign public key file (untrusted comment, key line). */
export function parsePublicKey(pubkey) {
  const keyLine = lines(utf8(decodeBase64(pubkey, "public key"), "public key"))[1] ?? fail("public key has no key line");
  const raw = decodeBase64(keyLine, "public key line");
  if (raw.length !== 42) fail("public key is not a minisign Ed25519 key");
  if (raw[0] !== 0x45 || (raw[1] !== 0x64 && raw[1] !== 0x44)) fail("public key algorithm is not Ed25519");
  return { keyId: raw.subarray(2, 10), key: raw.subarray(10, 42) };
}

const ed25519Verify = (key, message, signature) =>
  verify(null, message, createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, key]), format: "der", type: "spki" }), signature);

/**
 * Throws unless `signature` (a `.sig` file's content: base64 of a minisign signature file) signs
 * `data` with `pubkey` and its trusted comment names `SLUI-Setup-<version>.exe` and `<version>`.
 * Returns the trusted comment.
 */
export function verifyUpdaterSignature({ data, signature, pubkey, version }) {
  const publicKey = parsePublicKey(pubkey);
  const signatureLines = lines(utf8(decodeBase64(signature.trim(), "signature file"), "signature file"));
  if (signatureLines.length < 4) fail("signature file has fewer than 4 lines");
  const [, sigLine, commentLine, globalLine] = signatureLines;
  const sig = decodeBase64(sigLine, "signature line");
  const globalSig = decodeBase64(globalLine, "global signature line");
  if (sig.length !== 74 || globalSig.length !== 64) fail("signature lines have the wrong length");
  if (!commentLine.startsWith(TRUSTED_PREFIX)) fail("third line is not the trusted comment");
  const algorithm = sig.subarray(0, 2).toString("latin1");
  if (algorithm !== "ED" && algorithm !== "Ed") fail(`unsupported signature algorithm ${JSON.stringify(algorithm)}`);
  const keyId = sig.subarray(2, 10);
  if (!keyId.equals(publicKey.keyId)) {
    fail(`signed with key ${keyId.toString("hex")}, but tauri.conf.json's updater key is ${publicKey.keyId.toString("hex")}`);
  }
  const ed = sig.subarray(10);
  const message = algorithm === "ED" ? createHash("blake2b512").update(data).digest() : data;
  if (!ed25519Verify(publicKey.key, message, ed)) fail("signature does not match the file");
  const trustedComment = commentLine.slice(TRUSTED_PREFIX.length);
  if (!ed25519Verify(publicKey.key, Buffer.concat([ed, Buffer.from(trustedComment, "utf8")]), globalSig)) {
    fail("global signature does not match the trusted comment");
  }
  const fields = trustedComment.split("\t");
  const field = (name) => fields.find((entry) => entry.startsWith(`${name}:`))?.slice(name.length + 1) ?? null;
  const expectedFile = `SLUI-Setup-${version}.exe`;
  if (field("file") !== expectedFile) fail(`signed file name is ${field("file") ?? "(none)"}, SLUI requires ${expectedFile}`);
  if (field("version") !== version) fail(`signed version is ${field("version") ?? "(none)"}, expected ${version}`);
  return trustedComment;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [installer, signatureFile, version] = process.argv.slice(2);
  if (!installer || !signatureFile || !version) {
    console.error("usage: node scripts/verify-updater-signature.mjs <SLUI-Setup-X.Y.Z.exe> <.sig> <X.Y.Z>");
    process.exit(2);
  }
  try {
    if (basename(installer) !== `SLUI-Setup-${version}.exe`) fail(`installer is ${basename(installer)}, expected SLUI-Setup-${version}.exe`);
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const pubkey = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8")).plugins?.updater?.pubkey;
    if (typeof pubkey !== "string") fail("src-tauri/tauri.conf.json has no plugins.updater.pubkey");
    const comment = verifyUpdaterSignature({
      data: readFileSync(installer),
      signature: readFileSync(signatureFile, "utf8"),
      pubkey,
      version,
    });
    console.log(`updater signature verified against tauri.conf.json's key (${comment})`);
  } catch (error) {
    console.error(`::error::updater signature check failed: ${error.message}`);
    process.exit(1);
  }
}
