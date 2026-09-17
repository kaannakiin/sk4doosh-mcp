import type { Locale } from "@chat/contracts/common/locale";
import { sanitizeToolDescription } from "@chat/contracts/integration/tool-description";
import { sanitizeToolInputSchema } from "@chat/contracts/integration/tool-input-schema";
import { findToolsInputSchema } from "@chat/contracts/tools/discovery/find-tools";
import { Injectable, Logger } from "@nestjs/common";
import { jsonSchema, tool, type ModelMessage, type ToolSet } from "ai";

import { IntegrationCatalogService } from "../connections/integration-catalog.service.ts";
import {
  exposedToolNameFor,
  looksExposed,
  resolveToolNames,
} from "../connections/remote-tool-names.ts";
import type { CatalogTool } from "../connections/integration-tool.repository.ts";
import type { UserId } from "../db/ids.ts";
import { I18nService } from "../i18n/i18n.service.ts";
import { RemoteToolInvoker } from "./remote-tool-invoker.ts";

const MAX_SEARCH_RESULTS = 10;

/**
 * Guard: a ceiling on what one turn may reveal, not on what the reader may
 * connect. Without it a broad search puts every tool of every server back into
 * the prompt, which is the cost `find_tools` exists to avoid.
 */
const MAX_REVEALED = 24;

const OPAQUE_INPUT = { type: "object", additionalProperties: true } as const;

export interface RemoteToolSurface {
  readonly tools: ToolSet;
  readonly byExposedName: ReadonlyMap<string, CatalogTool>;
  readonly instructions: string | undefined;
  activeToolsFor(local: readonly string[]): readonly string[];
}

const EMPTY: RemoteToolSurface = {
  tools: {},
  byExposedName: new Map(),
  instructions: undefined,
  activeToolsFor: (local) => local,
};

function summarize(entry: CatalogTool): string {
  return sanitizeToolDescription(entry.title, entry.description);
}

/**
 * Guard: search reads what the server wrote, not what the model is shown.
 * `summarize` bounds its output at a length that would drop the tail of a long
 * description, and a term that only appears there is still the reader's best
 * handle on the tool they are looking for.
 */
function searchable(entry: CatalogTool): string {
  return [
    entry.remoteName,
    entry.title,
    entry.description,
    entry.integrationName,
  ]
    .filter((part) => part !== null && part !== "")
    .join(" ")
    .toLowerCase();
}

@Injectable()
export class RemoteToolSetService {
  private readonly logger = new Logger(RemoteToolSetService.name);

  constructor(
    private readonly catalog: IntegrationCatalogService,
    private readonly invoker: RemoteToolInvoker,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Builds the remote half of a turn's tool surface.
   *
   * Guard: every tool of every connected server is declared, but only the ones
   * `find_tools` has surfaced are made active. `activeTools` is what the SDK
   * serializes into the provider request, so a reader with sixty tools pays for
   * the two the model actually asked for.
   *
   * Guard: a tool name the conversation already used is active from the first
   * step. A model re-uses a tool far more readily than it re-searches, and a
   * call to an inactive name costs a step and comes back as a tool error.
   *
   * Guard: a name in the history that no longer exists gets a tombstone rather
   * than being left out. An approval resumed for a tool that is gone produces no
   * tool result at all — an assistant turn with a dangling call, which is the
   * empty turn and the resend loop `ChatService` already documents.
   *
   * @param userId the subject of the trusted session
   * @param history the messages already converted for the model
   * @param locale the language the reader is reading
   * @returns the tools, the instructions naming the servers, and the step filter
   */
  async surfaceFor(
    userId: UserId,
    history: readonly ModelMessage[],
    locale: Locale,
  ): Promise<RemoteToolSurface> {
    const catalog = await this.catalog.catalogFor(userId);
    const usable = catalog.filter(({ scoped }) => scoped);
    const { byExposedName, conflicts } = resolveToolNames(
      usable.map((entry) => ({
        ...entry,
        integrationPublicId: entry.integrationPublicId,
      })),
    );

    for (const conflict of conflicts) {
      this.logger.warn(
        `dropping ${conflict.remoteName} on ${conflict.integrationPublicId}: its exposed name is already taken`,
      );
    }

    const seen = [...namesIn(history)].filter(looksExposed);
    if (byExposedName.size === 0 && seen.length === 0) {
      return EMPTY;
    }

    const revealed = new Set<string>(
      seen.filter((name) => byExposedName.has(name)),
    );

    const tools: ToolSet = {
      find_tools: this.searchTool(usable, revealed, locale),
    };

    for (const [exposed, entry] of byExposedName) {
      tools[exposed] = tool({
        metadata: { policy: entry.destructive ? "always" : "askable" },
        description: summarize(entry),
        inputSchema: jsonSchema(
          sanitizeToolInputSchema(entry.inputSchema) as Record<string, unknown>,
        ),
        execute: async (args: unknown) =>
          this.invoker.invoke(userId, entry, args, locale),
      });
    }

    for (const name of seen) {
      if (tools[name] === undefined) {
        tools[name] = this.tombstone(locale);
      }
    }

    return {
      tools,
      byExposedName,
      instructions: this.manifest(usable, locale),
      activeToolsFor: (local) => [...local, "find_tools", ...revealed],
    };
  }

  private searchTool(
    catalog: readonly CatalogTool[],
    revealed: Set<string>,
    locale: Locale,
  ) {
    return tool({
      metadata: { policy: "auto" },
      description: this.i18n.t("chat:tools.find.description", {}, locale),
      inputSchema: findToolsInputSchema,
      execute: ({ query }: { query: string }) => {
        const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
        const scored = catalog
          .map((entry) => ({
            entry,
            hits: terms.filter((term) => searchable(entry).includes(term))
              .length,
          }))
          .filter(({ hits }) => hits > 0)
          .sort((left, right) => right.hits - left.hits)
          .slice(0, MAX_SEARCH_RESULTS);

        if (scored.length === 0) {
          return {
            found: [],
            note: this.i18n.t("chat:tools.none", {}, locale),
          };
        }

        const found = scored.map(({ entry }) => {
          const name = exposedToolNameFor(
            entry.integrationPublicId,
            entry.remoteName,
          );
          if (revealed.size < MAX_REVEALED) {
            revealed.add(name);
          }

          return {
            name,
            server: entry.integrationName,
            description: summarize(entry),
          };
        });

        return { found };
      },
    });
  }

  private tombstone(locale: Locale) {
    const message = this.i18n.t("chat:tools.unavailable", {}, locale);

    return tool({
      description: message,
      inputSchema: jsonSchema(
        OPAQUE_INPUT as unknown as Record<string, unknown>,
      ),
      execute: () => Promise.resolve({ ok: false, error: message }),
    });
  }

  private manifest(catalog: readonly CatalogTool[], locale: Locale): string {
    const counts = new Map<string, number>();
    for (const { integrationName } of catalog) {
      counts.set(integrationName, (counts.get(integrationName) ?? 0) + 1);
    }

    const servers = [...counts]
      .map(([name, count]) => `- ${name} (${count})`)
      .join("\n");

    return `${this.i18n.t("chat:tools.manifest", {}, locale)}\n${servers}`;
  }
}

function namesIn(history: readonly ModelMessage[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const message of history) {
    if (!Array.isArray(message.content)) {
      continue;
    }

    for (const part of message.content) {
      if (
        typeof part === "object" &&
        part !== null &&
        part.type === "tool-call"
      ) {
        names.add(part.toolName);
      }
    }
  }

  return names;
}
