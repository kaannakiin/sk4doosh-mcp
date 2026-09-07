import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { DemoOAuthProvider } from "./oauth-provider.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly provider: DemoOAuthProvider) {}

  @Post("token")
  async token(@Body() body: { user?: string }) {
    const user = body?.user;
    if (user !== "alice" && user !== "bob" && user !== "carol") {
      throw new BadRequestException("user must be 'alice', 'bob' or 'carol'");
    }
    return { access_token: await this.provider.mintDemoToken(user) };
  }
}
