import type { Request } from "express";

import type { OwnerId } from "./owner-id.ts";

export interface RequestWithOwner extends Request {
  owner?: OwnerId;
}
