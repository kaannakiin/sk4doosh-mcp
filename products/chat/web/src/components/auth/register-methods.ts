import type { AuthMethod } from "./AuthMethodSwitch";

export const REGISTER_METHODS: readonly AuthMethod[] = [
  { to: "/auth/register", labelKey: "auth.register.methodEmail" },
  { to: "/auth/register/phone", labelKey: "auth.register.methodPhone" },
];
