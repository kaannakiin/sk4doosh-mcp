import type { InitializeParams } from "../protocol/generated/InitializeParams.ts";
import type { InitializeResponse } from "../protocol/generated/InitializeResponse.ts";
import type { AccountRateLimitsUpdatedNotification } from "../protocol/generated/v2/AccountRateLimitsUpdatedNotification.ts";
import type { AgentMessageDeltaNotification } from "../protocol/generated/v2/AgentMessageDeltaNotification.ts";
import type { ErrorNotification } from "../protocol/generated/v2/ErrorNotification.ts";
import type { ItemCompletedNotification } from "../protocol/generated/v2/ItemCompletedNotification.ts";
import type { ItemStartedNotification } from "../protocol/generated/v2/ItemStartedNotification.ts";
import type { McpServerStatusUpdatedNotification } from "../protocol/generated/v2/McpServerStatusUpdatedNotification.ts";
import type { ModelListParams } from "../protocol/generated/v2/ModelListParams.ts";
import type { ModelListResponse } from "../protocol/generated/v2/ModelListResponse.ts";
import type { ThreadCompactStartParams } from "../protocol/generated/v2/ThreadCompactStartParams.ts";
import type { ThreadCompactStartResponse } from "../protocol/generated/v2/ThreadCompactStartResponse.ts";
import type { ThreadResumeParams } from "../protocol/generated/v2/ThreadResumeParams.ts";
import type { ThreadResumeResponse } from "../protocol/generated/v2/ThreadResumeResponse.ts";
import type { ThreadStartedNotification } from "../protocol/generated/v2/ThreadStartedNotification.ts";
import type { ThreadStartParams } from "../protocol/generated/v2/ThreadStartParams.ts";
import type { ThreadStartResponse } from "../protocol/generated/v2/ThreadStartResponse.ts";
import type { ThreadUnsubscribeParams } from "../protocol/generated/v2/ThreadUnsubscribeParams.ts";
import type { ThreadUnsubscribeResponse } from "../protocol/generated/v2/ThreadUnsubscribeResponse.ts";
import type { ThreadTokenUsageUpdatedNotification } from "../protocol/generated/v2/ThreadTokenUsageUpdatedNotification.ts";
import type { TurnCompletedNotification } from "../protocol/generated/v2/TurnCompletedNotification.ts";
import type { TurnInterruptParams } from "../protocol/generated/v2/TurnInterruptParams.ts";
import type { TurnInterruptResponse } from "../protocol/generated/v2/TurnInterruptResponse.ts";
import type { TurnStartedNotification } from "../protocol/generated/v2/TurnStartedNotification.ts";
import type { TurnStartParams } from "../protocol/generated/v2/TurnStartParams.ts";
import type { TurnStartResponse } from "../protocol/generated/v2/TurnStartResponse.ts";

interface Call<P, R> {
  readonly params: P;
  readonly result: R;
}

export interface AppServerRequests {
  initialize: Call<InitializeParams, InitializeResponse>;
  "model/list": Call<ModelListParams, ModelListResponse>;
  "thread/start": Call<ThreadStartParams, ThreadStartResponse>;
  "thread/resume": Call<ThreadResumeParams, ThreadResumeResponse>;
  "thread/unsubscribe": Call<
    ThreadUnsubscribeParams,
    ThreadUnsubscribeResponse
  >;
  "turn/start": Call<TurnStartParams, TurnStartResponse>;
  "turn/interrupt": Call<TurnInterruptParams, TurnInterruptResponse>;
  "thread/compact/start": Call<
    ThreadCompactStartParams,
    ThreadCompactStartResponse
  >;
}

export type AppServerMethod = keyof AppServerRequests;

export type ParamsOf<M extends AppServerMethod> =
  AppServerRequests[M]["params"];

export type ResultOf<M extends AppServerMethod> =
  AppServerRequests[M]["result"];

export interface AppServerNotifications {
  "thread/started": ThreadStartedNotification;
  "turn/started": TurnStartedNotification;
  "turn/completed": TurnCompletedNotification;
  "item/started": ItemStartedNotification;
  "item/completed": ItemCompletedNotification;
  "item/agentMessage/delta": AgentMessageDeltaNotification;
  "thread/tokenUsage/updated": ThreadTokenUsageUpdatedNotification;
  "account/rateLimits/updated": AccountRateLimitsUpdatedNotification;
  "mcpServer/startupStatus/updated": McpServerStatusUpdatedNotification;
  error: ErrorNotification;
}

export type AppServerNotification = {
  [M in keyof AppServerNotifications]: {
    readonly method: M;
    readonly params: AppServerNotifications[M];
  };
}[keyof AppServerNotifications];

export const NOTIFICATION_METHODS: Readonly<
  Record<keyof AppServerNotifications, true>
> = {
  "thread/started": true,
  "turn/started": true,
  "turn/completed": true,
  "item/started": true,
  "item/completed": true,
  "item/agentMessage/delta": true,
  "thread/tokenUsage/updated": true,
  "account/rateLimits/updated": true,
  "mcpServer/startupStatus/updated": true,
  error: true,
};

export function isKnownNotification(
  method: string,
): method is keyof AppServerNotifications {
  return Object.hasOwn(NOTIFICATION_METHODS, method);
}
