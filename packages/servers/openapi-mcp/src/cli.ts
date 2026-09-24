#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { DocumentLoader } from "@sk-mcp/openapi";
import { buildGatewayCatalog, summarize } from "./catalog/build.js";
import { createBoundedFetch, HostNotAllowed } from "./net/fetch.js";
import { asciiLower } from "./platform/ascii.js";
import { readConfig } from "./platform/config.js";
import { directoryOf, readText, readWithin } from "./platform/files.js";
import { createOpenApiMcpServer } from "./server.js";
import { createTokenExchange } from "./credentials/token-exchange.js";
import { serveHttp } from "./transport/http.js";

function stop(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

/**
 * Guard: the config path is read by name so `turbo/no-undeclared-env-vars` forces it into
 * `passThroughEnv`. The secrets a config names are read through the lookup below, the one place
 * this package reads an arbitrary variable, because their names belong to the operator.
 */
const configPath = process.env["SKMCP_OPENAPI_CONFIG"];
if (configPath === undefined || configPath === "") {
  stop(
    "sk-mcp-openapi reads its config from the file SKMCP_OPENAPI_CONFIG names.",
    2,
  );
}

let raw: unknown;
try {
  raw = JSON.parse(await readText(configPath));
} catch (error) {
  stop(`sk-mcp-openapi cannot read its config: ${(error as Error).message}`, 2);
}

const outcome = readConfig(raw, (name) => process.env[name]);
if (outcome.kind === "invalid") {
  stop(outcome.reason, 2);
}
const { config, credentials } = outcome;

const isUrl = /^https?:\/\//i.test(config.source);
const sourcePath = isUrl
  ? undefined
  : resolve(directoryOf(configPath), config.source);
const documentUrl = isUrl
  ? config.source
  : new URL(`file://${sourcePath ?? ""}`).href;
const documentHost = isUrl
  ? asciiLower(new URL(config.source).host)
  : undefined;
const documentFetch = createBoundedFetch(
  new Set([
    ...(documentHost === undefined ? [] : [documentHost]),
    ...config.refHosts.map((host) => asciiLower(host)),
  ]),
);
const documentLimit = 64 * 1024 * 1024;

async function readDocument(url: URL): Promise<string> {
  if (url.protocol === "file:") {
    return readWithin(directoryOf(sourcePath ?? "."), fileURLToPath(url));
  }
  const response = await documentFetch(
    {
      method: "GET",
      url,
      headers: {
        accept: "application/json, application/yaml;q=0.9, */*;q=0.1",
      },
    },
    AbortSignal.timeout(config.limits.timeoutMs),
    documentLimit,
  );
  if (response.status !== 200 || response.body === undefined) {
    throw new Error(
      `sk-mcp-openapi: ${url.href} answered ${String(response.status)}.`,
    );
  }
  return response.body;
}

const loader: DocumentLoader = readDocument;

let text: string;
try {
  text = isUrl
    ? await readDocument(new URL(config.source))
    : await readText(sourcePath ?? "");
} catch (error) {
  stop(
    `sk-mcp-openapi cannot read the document: ${(error as Error).message}`,
    2,
  );
}

const gateway = await buildGatewayCatalog(
  text,
  config,
  credentials,
  config.allowHosts,
  documentUrl,
  loader,
).catch((error: unknown) =>
  stop(
    error instanceof HostNotAllowed
      ? `sk-mcp-openapi: the document references a schema on '${error.host}', which is not a reference host; add it to "refHosts" in the config to allow it.`
      : `sk-mcp-openapi cannot resolve the document: ${(error as Error).message}`,
    2,
  ),
);
for (const line of summarize(gateway.ingestion, gateway.catalog.diagnostics)) {
  process.stderr.write(`${line}\n`);
}
process.stderr.write(
  `sk-mcp-openapi: ${String(gateway.catalog.entries.length)} tool(s) from ${String(gateway.catalog.selected)} selected operation(s).\n`,
);
if (
  gateway.catalog.fatal.length > 0 ||
  gateway.ingestion.some((d) => d.severity === "fatal")
) {
  stop("sk-mcp-openapi: the catalog has fatal diagnostics; see above.", 1);
}

const fetcher = createBoundedFetch(gateway.allowedHosts);
const factory = () => createOpenApiMcpServer(gateway, fetcher, config.limits);

if (config.transport.kind === "http") {
  const exchangeConfig = config.tokenExchange;
  const exchange =
    exchangeConfig === undefined
      ? undefined
      : createTokenExchange(
          exchangeConfig,
          outcome.clientSecret ?? "",
          createBoundedFetch(
            new Set([asciiLower(new URL(exchangeConfig.tokenEndpoint).host)]),
          ),
          config.limits.timeoutMs,
        );
  const listening = await serveHttp(factory, exchange, config.transport);
  process.stderr.write(
    `sk-mcp-openapi: listening on http://${config.transport.host}:${String(config.transport.port)}${config.transport.path}\n`,
  );
  const close = (): void => {
    listening.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
} else {
  serveOverStdio();
}

function serveOverStdio(): void {
  const handle = serveStdio(factory, {
    onerror: (error) => {
      process.stderr.write(`${error.message}\n`);
    },
  });
  const shutdown = (): void => {
    void handle.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
