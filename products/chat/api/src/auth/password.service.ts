import { Injectable } from "@nestjs/common";
import { argon2id, hash, needsRehash, verify } from "argon2";

const DUMMY_PASSWORD = "not-a-user-password";

@Injectable()
export class PasswordService {
  private readonly dummyHash = this.hash(DUMMY_PASSWORD);

  hash(password: string): Promise<string> {
    return hash(password, { type: argon2id });
  }

  verify(encoded: string, password: string): Promise<boolean> {
    return verify(encoded, password);
  }

  needsRehash(encoded: string): boolean {
    return needsRehash(encoded);
  }

  async burnDummy(password: string): Promise<void> {
    await verify(await this.dummyHash, password);
  }
}
