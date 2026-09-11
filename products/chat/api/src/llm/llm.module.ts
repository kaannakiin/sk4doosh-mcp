import { Module } from "@nestjs/common";

import { LlmService } from "./llm.service.ts";

@Module({ providers: [LlmService], exports: [LlmService] })
export class LlmModule {}
