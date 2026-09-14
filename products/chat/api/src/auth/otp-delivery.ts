import type { AuthChannel } from "@chat/contracts/auth/auth";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../config/configuration.ts";

export const OTP_DELIVERY = Symbol("OTP_DELIVERY");

export interface OtpDeliveryMessage {
  readonly challengeId: string;
  readonly channel: AuthChannel;
  readonly maskedTarget: string;
  readonly code: string;
  readonly expiresAt: Date;
}

export interface OtpDelivery {
  send(message: OtpDeliveryMessage): Promise<void>;
}

@Injectable()
export class LoggingOtpDelivery implements OtpDelivery {
  private readonly logger = new Logger(LoggingOtpDelivery.name);

  constructor(config: ConfigService<AppConfig, true>) {
    if (config.get("environment", { infer: true }) === "production") {
      throw new Error(
        "LoggingOtpDelivery is development-only; configure a production OTP delivery adapter",
      );
    }
  }

  async send(message: OtpDeliveryMessage): Promise<void> {
    this.logger.debug(
      `otp challenge=${message.challengeId} channel=${message.channel} target=${message.maskedTarget} code=${message.code} expires=${message.expiresAt.toISOString()}`,
    );
  }
}

export const InjectOtpDelivery = () => Inject(OTP_DELIVERY);
