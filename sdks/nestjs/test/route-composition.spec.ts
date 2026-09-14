import "reflect-metadata";
import {
  Controller,
  Get,
  Module,
  Param,
  Version,
  VersioningType,
  type INestApplication,
} from "@nestjs/common";
import { RouterModule } from "@nestjs/core";
import { Test, type TestingModuleBuilder } from "@nestjs/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { SkMcpCatalog } from "../src/catalog.js";
import { McpTool } from "../src/decorators.js";
import { SkMcpModule } from "../src/sk-mcp.module.js";
import type {
  SkMcpOptions,
  SkMcpResourceServerOptions,
} from "../src/options.js";

@Controller("orders")
@McpTool()
class PrefixedOrdersController {
  @Get(":id")
  getOrder(@Param("id") _id: string): string {
    return "ok";
  }
}

@Controller("health")
@McpTool()
class HealthController {
  @Get()
  check(): string {
    return "ok";
  }
}

@Controller("mcp")
@McpTool()
class LookalikeMcpController {
  @Get()
  handle(): string {
    return "ok";
  }
}

@Controller(["orders", "purchases"])
@McpTool()
class MultiPathController {
  @Get(":id")
  getOrder(@Param("id") _id: string): string {
    return "ok";
  }
}

@Controller({ path: "orders", version: "1" })
@McpTool()
class VersionedOrdersController {
  @Get()
  list(): string {
    return "ok";
  }

  @Get("archive")
  @Version("2")
  archive(): string {
    return "ok";
  }
}

@Controller("orders")
@McpTool()
class MountedOrdersController {
  @Get()
  list(): string {
    return "ok";
  }
}

@Module({ controllers: [MountedOrdersController] })
class OrdersFeatureModule {}

async function catalogOf(
  build: TestingModuleBuilder,
  prepare?: (app: INestApplication) => void,
): Promise<SkMcpCatalog> {
  const moduleRef = await build.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  prepare?.(app);
  await app.init();
  return app.get(SkMcpCatalog);
}

const routesOf = (catalog: SkMcpCatalog): string[] =>
  catalog.current.entries.map((entry) => entry.descriptor.route).sort();

describe("R1: global prefix", () => {
  let catalog: SkMcpCatalog;

  beforeAll(async () => {
    catalog = await catalogOf(
      Test.createTestingModule({
        imports: [SkMcpModule.forRoot()],
        controllers: [
          PrefixedOrdersController,
          HealthController,
          LookalikeMcpController,
        ],
      }),
      (app) => app.setGlobalPrefix("api", { exclude: ["health"] }),
    );
  });

  it("puts the global prefix in the route", () => {
    expect(routesOf(catalog)).toContain("/api/orders/{id}");
  });

  it("honours the prefix exclusion list", () => {
    expect(routesOf(catalog)).toContain("/health");
  });

  it("still filters the reserved mcp path once it carries the prefix", () => {
    expect(routesOf(catalog)).not.toContain("/api/mcp");
    expect(catalog.current.entries).toHaveLength(2);
  });
});

describe("R2: a controller mounted at several paths", () => {
  let catalog: SkMcpCatalog;

  beforeAll(async () => {
    catalog = await catalogOf(
      Test.createTestingModule({
        imports: [SkMcpModule.forRoot()],
        controllers: [MultiPathController],
      }),
    );
  });

  it("produces one tool and invokes the deterministic route", () => {
    expect(catalog.current.entries).toHaveLength(1);
    expect(catalog.current.entries[0]?.descriptor.route).toBe("/orders/{id}");
  });

  it("keeps the folded route in the search index", () => {
    expect(catalog.current.entries[0]?.alternateRoutes).toEqual([
      "/purchases/{id}",
    ]);
    expect(catalog.current.index.search("purchases", 5)).toEqual([
      "multi_path_get_order",
    ]);
  });

  it("reports the folding instead of dropping it silently", () => {
    const folded = catalog.diagnostics.find(
      (diagnostic) => diagnostic.code === "route_folded",
    );
    expect(folded?.message).toContain("/purchases/{id}");
    expect(folded?.message).toContain("/orders/{id}");
  });
});

describe("R3: URI versioning", () => {
  let catalog: SkMcpCatalog;

  beforeAll(async () => {
    catalog = await catalogOf(
      Test.createTestingModule({
        imports: [SkMcpModule.forRoot()],
        controllers: [VersionedOrdersController],
      }),
      (app) => {
        app.setGlobalPrefix("api");
        app.enableVersioning({ type: VersioningType.URI });
      },
    );
  });

  it("writes the version segment the way Nest routes it", () => {
    expect(routesOf(catalog)).toEqual([
      "/api/v1/orders",
      "/api/v2/orders/archive",
    ]);
  });
});

describe("R4: a module mounted through RouterModule", () => {
  let catalog: SkMcpCatalog;

  beforeAll(async () => {
    catalog = await catalogOf(
      Test.createTestingModule({
        imports: [
          SkMcpModule.forRoot(),
          OrdersFeatureModule,
          RouterModule.register([
            { path: "admin", module: OrdersFeatureModule },
          ]),
        ],
      }),
    );
  });

  it("puts the module path in the route", () => {
    expect(routesOf(catalog)).toEqual(["/admin/orders"]);
  });
});

describe("R5: protected-resource metadata under a global prefix", () => {
  const resourceServer = {
    resource: new URL("https://api.example.com/mcp"),
    authorizationServers: [new URL("https://auth.example.com")],
    verifier: { verifyAccessToken: () => Promise.reject(new Error("unused")) },
  } as unknown as SkMcpResourceServerOptions;

  const configure = (options: SkMcpOptions): void => {
    options.resourceServer = resourceServer;
    options.diagnostics.failOn = undefined;
  };

  it("is fatal when the metadata path is not excluded from the prefix", async () => {
    const catalog = await catalogOf(
      Test.createTestingModule({
        imports: [SkMcpModule.forRoot(configure)],
        controllers: [PrefixedOrdersController],
      }),
      (app) => app.setGlobalPrefix("api"),
    );
    const prefixed = catalog.diagnostics.find(
      (diagnostic) => diagnostic.code === "prm_path_prefixed",
    );
    expect(prefixed?.message).toContain(
      "/.well-known/oauth-protected-resource/mcp",
    );
    expect(prefixed?.message).toContain("exclude");
  });

  it("is silent once the host excludes it", async () => {
    const catalog = await catalogOf(
      Test.createTestingModule({
        imports: [SkMcpModule.forRoot(configure)],
        controllers: [PrefixedOrdersController],
      }),
      (app) =>
        app.setGlobalPrefix("api", {
          exclude: ["/.well-known/oauth-protected-resource/mcp"],
        }),
    );
    expect(
      catalog.diagnostics.map((diagnostic) => diagnostic.code),
    ).not.toContain("prm_path_prefixed");
  });
});
