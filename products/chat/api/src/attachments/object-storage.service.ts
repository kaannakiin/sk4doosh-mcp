import type { Readiness } from "@chat/contracts/http/health";
import type { SupportedMediaType } from "@chat/contracts/attachment/media-type";
import { objectKeySchema } from "@chat/contracts/attachment/object-key";
import type { PresignDisposition } from "@chat/contracts/attachment/presign";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client } from "minio";
import type { Readable } from "node:stream";

import type { AppConfig, StorageConfig } from "../config/configuration.ts";

export interface PresignedUrl {
  readonly url: string;
  readonly expiresAt: string;
}

@Injectable()
export class ObjectStorageService implements OnModuleInit {
  private readonly logger = new Logger(ObjectStorageService.name);

  private readonly storage: StorageConfig;

  private readonly io: Client;

  /**
   * Guard: `signer` is built against the browser-reachable endpoint and is never
   * used for i/o. SigV4 signs the Host header, so a url signed against the
   * internal endpoint is rejected the moment the browser sends the public one.
   * Presigning performs no network call, so a client pointed at a host this
   * process cannot even resolve is correct by construction. Collapsing these two
   * into one produces urls that work in development — where both values are the
   * same — and 403 in every deployment where they are not.
   */
  private readonly signer: Client;

  private readiness: Readiness = "unconfigured";

  constructor(config: ConfigService<AppConfig, true>) {
    this.storage = config.get("storage", { infer: true });
    this.io = this.clientFor(this.storage.io);
    this.signer = this.clientFor(this.storage.signer);
  }

  /**
   * Guard: the bucket is verified, never created. Creating one under the wrong
   * credentials succeeds against the wrong tenant and the failure surfaces much
   * later as missing data, so a missing bucket is a refusal to start rather than
   * something to fix silently.
   */
  async onModuleInit(): Promise<void> {
    try {
      const exists = await this.io.bucketExists(this.storage.bucket);
      if (!exists) {
        throw new Error(`bucket ${this.storage.bucket} does not exist`);
      }
      this.readiness = "ready";
    } catch (cause) {
      this.readiness = "failed";
      this.logger.error(`object storage unavailable: ${describe(cause)}`);
    }
  }

  probe(): Readiness {
    return this.readiness;
  }

  async put(
    key: string,
    body: Buffer,
    mediaType: SupportedMediaType,
    metadata: Readonly<Record<string, string>>,
  ): Promise<void> {
    await this.io.putObject(
      this.storage.bucket,
      objectKeySchema.parse(key),
      body,
      body.length,
      {
        "Content-Type": mediaType,
        "Cache-Control": "private, max-age=31536000, immutable",
        ...metadata,
      },
    );
  }

  async read(key: string): Promise<Readable> {
    return this.io.getObject(this.storage.bucket, objectKeySchema.parse(key));
  }

  async remove(key: string): Promise<void> {
    await this.io.removeObject(this.storage.bucket, objectKeySchema.parse(key));
  }

  /**
   * Signs a short-lived url the browser can fetch directly.
   *
   * Guard: the response headers are part of the signed query string, so a client
   * cannot flip `attachment` to `inline` or restate the content type without
   * invalidating the signature. That is what makes the enforcement travel with
   * the url — it holds even after the url leaks.
   *
   * @param disposition what the server decided, never what the caller asked for
   */
  async presign(
    key: string,
    mediaType: SupportedMediaType,
    disposition: PresignDisposition,
    filename: string,
  ): Promise<PresignedUrl> {
    const url = await this.signer.presignedGetObject(
      this.storage.bucket,
      objectKeySchema.parse(key),
      this.storage.presignTtlSeconds,
      {
        "response-content-type":
          disposition === "inline" ? mediaType : "application/octet-stream",
        "response-content-disposition": contentDisposition(
          disposition,
          filename,
        ),
      },
    );

    return {
      url,
      expiresAt: new Date(
        Date.now() + this.storage.presignTtlSeconds * 1000,
      ).toISOString(),
    };
  }

  private clientFor(endpoint: StorageConfig["io"]): Client {
    return new Client({
      endPoint: endpoint.endPoint,
      port: endpoint.port,
      useSSL: endpoint.useSSL,
      accessKey: this.storage.accessKey,
      secretKey: this.storage.secretKey,
      region: this.storage.region,
      pathStyle: this.storage.pathStyle,
    });
  }
}

/**
 * Guard: the filename is emitted twice, once folded to ascii for the quoted form
 * and once percent-encoded per RFC 5987. A raw Turkish name in the quoted form
 * is a malformed response header, and a quote or a newline in it would let a
 * filename inject header syntax.
 */
function contentDisposition(
  disposition: PresignDisposition,
  filename: string,
): string {
  const ascii = filename.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/gu, "_");

  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
