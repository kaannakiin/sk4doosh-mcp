import type { Request } from "express";

import type { AuthPrincipal } from "./auth.types.ts";

export interface RequestWithAuth extends Request {
  auth?: AuthPrincipal;
}

export function requireAuth(request: RequestWithAuth): AuthPrincipal {
  if (request.auth === undefined) {
    throw new Error("AuthGuard did not attach an authenticated principal");
  }

  return request.auth;
}
