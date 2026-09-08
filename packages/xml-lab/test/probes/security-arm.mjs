import { readFileSync } from "node:fs";
import fs from "node:fs";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import { Buffer } from "node:buffer";

const [, , armName, fixtureFile, token] = process.argv;

const tripwires = {
  fsOpenSync: 0,
  fsReadFileSync: 0,
  fsExistsSync: 0,
  fsCreateReadStream: 0,
  netConnect: 0,
  httpRequest: 0,
  httpsRequest: 0,
  dnsLookup: 0,
  dnsResolve: 0,
};

const wrap = (target, key, counter) => {
  const original = target[key];
  if (typeof original !== "function") return;
  target[key] = function patched(...args) {
    tripwires[counter] += 1;
    return original.apply(this, args);
  };
};

wrap(fs, "openSync", "fsOpenSync");
wrap(fs, "readFileSync", "fsReadFileSync");
wrap(fs, "existsSync", "fsExistsSync");
wrap(fs, "createReadStream", "fsCreateReadStream");
wrap(net, "createConnection", "netConnect");
wrap(net, "connect", "netConnect");
wrap(http, "request", "httpRequest");
wrap(https, "request", "httpsRequest");
wrap(dns, "lookup", "dnsLookup");
wrap(dns, "resolve", "dnsResolve");
globalThis.fetch = () => {
  tripwires.httpRequest += 1;
  throw new Error("fetch trapped");
};

const engine = await import("libxml2-wasm");
const { XmlDocument, ParseOption, xmlCleanupInputProvider } = engine;

let sideModule = null;
if (
  armName === "arm2_import_side_module" ||
  armName === "arm3_register_providers" ||
  armName === "arm4_cleanup_after_register"
) {
  sideModule = await import("libxml2-wasm/lib/nodejs.mjs");
}

const HARDENED =
  ParseOption.XML_PARSE_NO_XXE |
  ParseOption.XML_PARSE_NONET |
  ParseOption.XML_PARSE_NO_SYS_CATALOG;

const PERMISSIVE =
  ParseOption.XML_PARSE_NOENT |
  ParseOption.XML_PARSE_DTDLOAD |
  ParseOption.XML_PARSE_DTDATTR;

let option = HARDENED;

if (armName === "arm3_register_providers") {
  const register =
    sideModule.xmlRegisterFsInputProviders ??
    sideModule.default?.xmlRegisterFsInputProviders;
  if (typeof register === "function") register();
  option = PERMISSIVE;
}

if (armName === "arm4_cleanup_after_register") {
  const register =
    sideModule.xmlRegisterFsInputProviders ??
    sideModule.default?.xmlRegisterFsInputProviders;
  if (typeof register === "function") register();
  xmlCleanupInputProvider();
  option = PERMISSIVE;
}

if (armName === "arm5_cleanup_at_start") {
  xmlCleanupInputProvider();
}

const fixtureSet = JSON.parse(readFileSync(fixtureFile, "utf8"));

const baseline = { ...tripwires };
const results = [];
let tokenSeen = false;

for (const fixture of fixtureSet) {
  const bytes = Buffer.from(fixture.base64, "base64");
  const entry = {
    id: fixture.id,
    accepted: false,
    errorClass: null,
    errorCode: null,
    dtdSeen: null,
    tokenInDocument: false,
    tokenInError: false,
    serialized: null,
  };
  try {
    const document = XmlDocument.fromBuffer(bytes, { option });
    entry.accepted = true;
    entry.dtdSeen = document.dtd !== null;
    let serialized = "";
    try {
      serialized = document.toString();
    } catch {
      serialized = "";
    }
    entry.serializedLength = serialized.length;
    if (serialized.includes(token)) {
      entry.tokenInDocument = true;
      tokenSeen = true;
    }
    document.dispose();
  } catch (error) {
    entry.errorClass = error.constructor.name;
    entry.errorCode = String(error.message).slice(0, 160);
    if (String(error.message).includes(token)) {
      entry.tokenInError = true;
      tokenSeen = true;
    }
  }
  results.push(entry);
}

const parseWindowDelta = Object.fromEntries(
  Object.entries(tripwires).map(([key, value]) => [
    key,
    value - (baseline[key] ?? 0),
  ]),
);

console.log(
  JSON.stringify({
    arm: armName,
    rootExportsHaveFsProviders: Object.keys(engine).includes(
      "xmlRegisterFsInputProviders",
    ),
    sideModuleLoaded: sideModule !== null,
    sideModuleExports:
      sideModule === null ? [] : Object.keys(sideModule).sort(),
    parseOptionWord: option,
    tripwires: parseWindowDelta,
    tripwiresIncludingModuleLoad: tripwires,
    tokenSeen,
    results,
  }),
);
