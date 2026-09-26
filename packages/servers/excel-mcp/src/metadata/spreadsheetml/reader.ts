import { createOoxmlReader } from "@liaiso/ooxml-core";
import { failOoxml } from "./errors.js";

const reader = createOoxmlReader({ fail: failOoxml });

export const { openPackage: openOpcPackage, readXmlPart, zipSource } = reader;
