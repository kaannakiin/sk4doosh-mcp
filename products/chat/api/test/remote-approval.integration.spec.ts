import type { ConfigService } from "@nestjs/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config/configuration.ts";
import { ToolApprovalGateService } from "../src/chat/tool-approval-gate.service.ts";
import { AuthorizationDiscoveryService } from "../src/connections/authorization-discovery.service.ts";
import { ClientRegistrationService } from "../src/connections/client-registration.service.ts";
import { CredentialCipherService } from "../src/connections/credential-cipher.service.ts";
import { IntegrationAuthorizationRepository } from "../src/connections/integration-authorization.repository.ts";
import { IntegrationAuthorizationService } from "../src/connections/integration-authorization.service.ts";
import { IntegrationRegistrationService } from "../src/connections/integration-registration.service.ts";
import { IntegrationRepository } from "../src/connections/integration.repository.ts";
import {
  IntegrationToolRepository,
  type CatalogTool,
} from "../src/connections/integration-tool.repository.ts";
import { exposedToolNameFor } from "../src/connections/remote-tool-names.ts";
import { ToolApprovalRepository } from "../src/connections/tool-approval.repository.ts";
import { ToolApprovalService } from "../src/connections/tool-approval.service.ts";
import { DbService } from "../src/db/db.service.ts";
import type { SessionId } from "@chat/contracts/chat/session";

import type { UserId } from "../src/db/ids.ts";
import { GLOBAL_SCOPE } from "../src/connections/tool-approval.repository.ts";
import { I18nService } from "../src/i18n/i18n.service.ts";
import { mcpStub, type StubTool } from "./mcp-stub.ts";
import { startStub, type Stub } from "./oauth-stub.ts";

const url = process.env.CHAT_TEST_DATABASE_URL;

const withDatabase = url === undefined ? describe.skip : describe;

const SECRET = Buffer.alloc(32, 43).toString("base64");

function configFor(databaseUrl: string): ConfigService<AppConfig, true> {
  const values: Record<string, unknown> = {
    environment: "development",
    pathPrefix: "/api",
    auth: { publicApiUrl: "http://127.0.0.1:5191" },
    "auth.secret": SECRET,
    database: { url: databaseUrl, poolMax: 4 },
  };

  return {
    get: (key: string): unknown => values[key],
  } as unknown as ConfigService<AppConfig, true>;
}

withDatabase("remote tool approvals", () => {
  const config = configFor(url ?? "");
  let db: DbService;
  let integrations: IntegrationRepository;
  let toolRows: IntegrationToolRepository;
  let approvalRows: ToolApprovalRepository;
  let approvals: ToolApprovalService;
  let gates: ToolApprovalGateService;
  let registration: IntegrationRegistrationService;
  let stub: Stub | undefined;
  const users: bigint[] = [];

  beforeAll(() => {
    db = new DbService(config);
    const cipher = new CredentialCipherService(config);
    integrations = new IntegrationRepository(db);
    toolRows = new IntegrationToolRepository(db);
    approvalRows = new ToolApprovalRepository(db);
    approvals = new ToolApprovalService(approvalRows, toolRows);
    gates = new ToolApprovalGateService(approvalRows, new I18nService());
    const discovery = new AuthorizationDiscoveryService(config);
    registration = new IntegrationRegistrationService(
      integrations,
      new IntegrationAuthorizationService(
        discovery,
        new ClientRegistrationService(config),
        new IntegrationAuthorizationRepository(db),
        cipher,
      ),
      discovery,
      config,
    );
  });

  afterEach(async () => {
    await stub?.close();
    stub = undefined;
    if (users.length > 0) {
      await db.client.user.deleteMany({
        where: { id: { in: users.splice(0) } },
      });
    }
  });

  afterAll(async () => {
    await db.onModuleDestroy();
  });

  async function owner(): Promise<UserId> {
    const row = await db.client.user.create({
      data: { firstName: "Kaan", lastName: "Akın" },
    });
    users.push(row.id);

    return row.id.toString() as UserId;
  }

  async function connect(userId: UserId, tools: readonly StubTool[]) {
    const server = mcpStub({ open: true, tools });
    stub = await startStub(server.handler);
    const outcome = await registration.register(userId, {
      mcpUrl: `${stub.origin}/mcp`,
    });
    if (outcome.kind === "refused") {
      throw new Error(`registration refused: ${outcome.failure}`);
    }

    return outcome.integration;
  }

  async function catalogMap(
    userId: UserId,
  ): Promise<ReadonlyMap<string, CatalogTool>> {
    const catalog = await toolRows.catalogFor(userId);

    return new Map(
      catalog.map((entry) => [
        exposedToolNameFor(entry.integrationPublicId, entry.remoteName),
        entry,
      ]),
    );
  }

  const SCOPED_SESSION = "00000000-0000-7000-8000-000000000001" as SessionId;

  async function ask(userId: UserId, exposedName: string): Promise<boolean> {
    const gate = await gates.gateFor(
      userId,
      SCOPED_SESSION,
      await catalogMap(userId),
      "en",
    );
    const status = gate(exposedName, false);

    return typeof status === "object" && status.type === "user-approval";
  }

  it("asks about a tool it has never seen, then stops after it is remembered", async () => {
    const userId = await owner();
    const integration = await connect(userId, [{ name: "list_zones" }]);
    const exposed = exposedToolNameFor(integration.id, "list_zones");

    expect(await ask(userId, exposed)).toBe(true);
    expect(await approvals.remember(userId, exposed, GLOBAL_SCOPE)).toBe(
      "changed",
    );
    expect(await ask(userId, exposed)).toBe(false);

    const rows = await db.client.toolApproval.count({
      where: { userId: BigInt(userId) },
    });
    expect(rows).toBe(1);
  });

  it("asks again once the server rewrites the tool's description", async () => {
    const userId = await owner();
    const integration = await connect(userId, [
      { name: "list_zones", description: "Lists zones." },
    ]);
    const exposed = exposedToolNameFor(integration.id, "list_zones");
    await approvals.remember(userId, exposed, GLOBAL_SCOPE);
    expect(await ask(userId, exposed)).toBe(false);

    await integrations.replaceTools(
      (
        await db.client.integration.findFirstOrThrow({
          where: { publicId: integration.id },
          select: { id: true },
        })
      ).id,
      [
        {
          name: "list_zones",
          description: "Lists zones and posts them elsewhere.",
          inputSchema: { type: "object" },
        },
      ],
    );

    expect(await ask(userId, exposed)).toBe(true);
  });

  it("asks again after the approval is forgotten", async () => {
    const userId = await owner();
    const integration = await connect(userId, [{ name: "list_zones" }]);
    const exposed = exposedToolNameFor(integration.id, "list_zones");
    await approvals.remember(userId, exposed, GLOBAL_SCOPE);

    expect(await approvals.forget(userId, exposed)).toBe("changed");
    expect(await ask(userId, exposed)).toBe(true);
  });

  it("always asks about a tool the server calls destructive", async () => {
    const userId = await owner();
    const integration = await connect(userId, [
      { name: "delete_zone", annotations: { destructiveHint: true } },
    ]);
    const exposed = exposedToolNameFor(integration.id, "delete_zone");

    expect(await approvals.remember(userId, exposed, GLOBAL_SCOPE)).toBe(
      "changed",
    );
    expect(await ask(userId, exposed)).toBe(true);
  });

  it("does not let a read-only claim earn silence", async () => {
    const userId = await owner();
    const integration = await connect(userId, [
      { name: "list_zones", annotations: { readOnlyHint: true } },
    ]);

    expect(
      await ask(userId, exposedToolNameFor(integration.id, "list_zones")),
    ).toBe(true);
  });

  it("suspends the memory in always_ask without removing it", async () => {
    const userId = await owner();
    const integration = await connect(userId, [{ name: "list_zones" }]);
    const exposed = exposedToolNameFor(integration.id, "list_zones");
    await approvals.remember(userId, exposed, GLOBAL_SCOPE);

    await approvalRows.setMode(userId, "always_ask");
    expect(await ask(userId, exposed)).toBe(true);
    expect(
      await db.client.toolApproval.count({ where: { userId: BigInt(userId) } }),
    ).toBe(1);

    await approvalRows.setMode(userId, "remember");
    expect(await ask(userId, exposed)).toBe(false);
  });

  it("refuses to remember a tool the server does not offer", async () => {
    const userId = await owner();
    const integration = await connect(userId, [{ name: "list_zones" }]);

    expect(
      await approvals.remember(
        userId,
        exposedToolNameFor(integration.id, "delete_everything"),
        GLOBAL_SCOPE,
      ),
    ).toBe("unknown_tool");
  });

  it("reports a withdrawn tool as unavailable rather than dropping the grant", async () => {
    const userId = await owner();
    const integration = await connect(userId, [{ name: "list_zones" }]);
    await approvals.remember(
      userId,
      exposedToolNameFor(integration.id, "list_zones"),
      GLOBAL_SCOPE,
    );

    const row = await db.client.integration.findFirstOrThrow({
      where: { publicId: integration.id },
      select: { id: true },
    });
    await integrations.replaceTools(row.id, []);

    const listed = await approvals.listFor(userId, integration.id);
    expect(listed).toHaveLength(1);
    expect(listed?.[0]?.available).toBe(false);
  });
});
