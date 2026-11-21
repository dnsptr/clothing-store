import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { MedusaService } from "@medusajs/framework/utils";
import CartAccess from "./models/cart-access";

class CheckoutAccessModuleService extends MedusaService({ CartAccess }) {
  async issueCartToken(cartId: string): Promise<string> {
    const token = randomBytes(32).toString("hex");
    await this.createCartAccesses({
      cart_id: cartId,
      token_digest: createHash("sha256").update(token).digest("hex"),
    });
    return token;
  }

  async verifyCartToken(cartId: string, token: unknown): Promise<boolean> {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return false;
    const [access] = await this.listCartAccesses({ cart_id: cartId });
    if (!access || !/^[a-f0-9]{64}$/.test(access.token_digest)) return false;
    return timingSafeEqual(
      Buffer.from(access.token_digest, "hex"),
      createHash("sha256").update(token).digest(),
    );
  }
}

export default CheckoutAccessModuleService;
