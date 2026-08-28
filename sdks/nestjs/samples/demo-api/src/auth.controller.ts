import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { mintToken } from "./auth.js";

@Controller("auth")
export class AuthController {
  @Post("token")
  token(@Body() body: { user?: string }) {
    const user = body?.user;
    if (user !== "alice" && user !== "bob") {
      throw new BadRequestException("user must be 'alice' or 'bob'");
    }
    return { token: mintToken(user, user === "alice" ? ["orders.read"] : []) };
  }
}
