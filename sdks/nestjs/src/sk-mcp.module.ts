import { Global, Module, type DynamicModule } from "@nestjs/common";
import { SkMcpDispatcher } from "./dispatcher.js";
import { SK_MCP_OPTIONS, SkMcpOptions } from "./options.js";

@Global()
@Module({})
export class SkMcpModule {
  static forRoot(configure?: (options: SkMcpOptions) => void): DynamicModule {
    const options = new SkMcpOptions();
    configure?.(options);
    return {
      module: SkMcpModule,
      providers: [
        { provide: SK_MCP_OPTIONS, useValue: options },
        SkMcpDispatcher,
      ],
      exports: [SkMcpDispatcher],
    };
  }
}
