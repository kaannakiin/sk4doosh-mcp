import type { Locale } from "@chat/contracts/common/locale";
import {
  EXCEL_TOOL_NAMES,
  XML_TOOL_NAMES,
} from "@chat/contracts/tools/tool-name";
import { Injectable } from "@nestjs/common";
import type { SystemModelMessage } from "ai";

import { I18nService } from "../i18n/i18n.service.ts";
import type { Manifest } from "./attachment-manifest.ts";

export const SYSTEM_PROMPT_KEYS = [
  "system.core",
  "system.tools.none",
  "system.tools.readers",
  "system.tools.workbook",
  "system.tools.document",
  "system.images",
  "system.readers_unavailable",
  "system.no_files",
  "system.files",
  "system.readable_files",
  "system.image_files",
] as const;

export interface SystemPromptInput {
  readonly toolNames: readonly string[];
  readonly attachments: Manifest;
  readonly remote: string | undefined;
  readonly codex: string | undefined;
}

@Injectable()
export class SystemPromptService {
  constructor(private readonly i18n: I18nService) {}

  /**
   * Builds the turn's standing instructions from the capabilities it actually
   * has.
   *
   * Guard: `toolNames` carries this product's own tools, never the remote
   * surface. Every usable catalog entry is declared up front whether or not
   * `find_tools` has revealed it, so a merged set would report tools the model
   * cannot call and would answer "no tool is available" wrongly. A connected
   * server is signalled by `remote` alone.
   *
   * Guard: the capability fragments are keyed on the tool names the model was
   * handed, not on which file families the session holds. A family is dropped
   * again when its command is unset and again when its subprocess fails to
   * start, so keying off files is how a deployment missing `CHAT_MCP_XML_CMD`
   * ends up being told to call `describe_document`.
   *
   * @param input the turn's tools, attachments and situational instructions
   * @param locale the language the user is reading
   * @returns the system messages, most stable first
   */
  compose(input: SystemPromptInput, locale: Locale): SystemModelMessage[] {
    const has = new Set(input.toolNames);
    const workbook = EXCEL_TOOL_NAMES.some((name) => has.has(name));
    const document = XML_TOOL_NAMES.some((name) => has.has(name));
    const readers = workbook || document;

    const sections: string[] = [];
    if (has.size === 0 && input.remote === undefined) {
      sections.push(this.text("system.tools.none", locale));
    } else if (readers) {
      sections.push(this.text("system.tools.readers", locale));
      if (workbook) {
        sections.push(this.text("system.tools.workbook", locale));
      }
      if (document) {
        sections.push(this.text("system.tools.document", locale));
      }
    }

    if (input.attachments.images.length > 0) {
      sections.push(this.text("system.images", locale));
    }
    if (input.attachments.readable.length > 0 && !readers) {
      sections.push(this.text("system.readers_unavailable", locale));
    }

    const messages: SystemModelMessage[] = [
      { role: "system", content: this.text("system.core", locale) },
    ];
    if (sections.length > 0) {
      messages.push({ role: "system", content: sections.join("\n\n") });
    }
    if (input.codex !== undefined) {
      messages.push({ role: "system", content: input.codex });
    }
    if (input.remote !== undefined) {
      messages.push({ role: "system", content: input.remote });
    }

    const files = this.files(input, locale);
    if (files !== undefined) {
      messages.push({ role: "system", content: files });
    }

    return messages;
  }

  /**
   * Guard: this is last because it is the only block that changes on every
   * upload. Ollama reuses its cache by longest common token prefix, so the
   * volatile content belongs after everything a turn can keep.
   */
  private files(
    input: SystemPromptInput,
    locale: Locale,
  ): string | undefined {
    const { readable, images } = input.attachments;
    if (readable.length === 0 && images.length === 0) {
      return input.codex === undefined
        ? undefined
        : this.i18n.t(
            "chat:system.files",
            { files: this.text("system.no_files", locale) },
            locale,
          );
    }

    const sections: string[] = [];
    if (readable.length > 0) {
      sections.push(
        `${this.text("system.readable_files", locale)}\n${readable.join("\n")}`,
      );
    }
    if (images.length > 0) {
      sections.push(
        `${this.text("system.image_files", locale)}\n${images.join("\n")}`,
      );
    }

    return this.i18n.t(
      "chat:system.files",
      { files: sections.join("\n\n") },
      locale,
    );
  }

  private text(key: string, locale: Locale): string {
    return this.i18n.t(`chat:${key}`, {}, locale);
  }
}
