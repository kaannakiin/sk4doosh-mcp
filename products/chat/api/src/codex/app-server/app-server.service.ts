import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createRequire } from "node:module";
import type { Readable, Writable } from "node:stream";

import type { AppConfig, CodexConfig } from "../../config/configuration.ts";
import { JsonRpcConnection } from "./json-rpc.ts";

type AppServerProcess = ChildProcessByStdio<Writable, Readable, null>;

const PROCESS_CONFIG = ["features.plugins=false", "features.apps=false"];

interface Running {
  readonly child: AppServerProcess;
  readonly connection: Promise<JsonRpcConnection>;
}

@Injectable()
export class AppServerService implements OnModuleDestroy {
  private readonly logger = new Logger(AppServerService.name);

  private readonly settings: CodexConfig;

  private running: Running | undefined;

  constructor(config: ConfigService<AppConfig, true>) {
    this.settings = config.get("codex", { infer: true });
  }

  get configured(): boolean {
    return this.settings.home !== undefined;
  }

  connection(): Promise<JsonRpcConnection> {
    this.running ??= this.start();

    return this.running.connection;
  }

  onModuleDestroy(): void {
    this.running?.child.kill();
    this.running = undefined;
  }

  private start(): Running {
    const home = this.settings.home ?? "";
    const [command, ...prefix] = this.command();
    /**
     * Guard: the environment is an allowlist, for the reason `CodexClientService`
     * gives — a credential this server holds for itself must not reach the agent.
     */
    const child = spawn(
      command,
      [
        ...prefix,
        "app-server",
        ...PROCESS_CONFIG.flatMap((entry) => ["-c", entry]),
      ],
      {
        env: { PATH: process.env.PATH ?? "", HOME: home, CODEX_HOME: home },
        stdio: ["pipe", "pipe", "inherit"],
      },
    );
    const connection = new JsonRpcConnection(child.stdout, child.stdin);
    const ready = this.handshake(connection);
    ready.catch(() => child.kill());
    const running: Running = { child, connection: ready };

    child.once("exit", (code, signal) => {
      connection.close(
        new Error(`codex app-server exited (${signal ?? code ?? "unknown"})`),
      );
      if (this.running === running) {
        this.running = undefined;
      }
      this.logger.warn(`codex app-server exited (${signal ?? code})`);
    });
    child.once("error", (cause) => {
      connection.close(cause);
    });

    return running;
  }

  private async handshake(
    connection: JsonRpcConnection,
  ): Promise<JsonRpcConnection> {
    await connection.request("initialize", {
      clientInfo: { name: "sk-mcp-chat", title: null, version: "0.0.0" },
      capabilities: null,
    });
    connection.notify("initialized");

    return connection;
  }

  private command(): readonly [string, ...string[]] {
    if (this.settings.binary !== undefined) {
      return [this.settings.binary];
    }

    return [
      process.execPath,
      createRequire(import.meta.url).resolve("@openai/codex/bin/codex.js"),
    ];
  }
}
