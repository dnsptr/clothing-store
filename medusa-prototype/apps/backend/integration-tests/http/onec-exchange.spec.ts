import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { ContainerRegistrationKeys, generateJwtToken, Modules } from "@medusajs/framework/utils";
import type { ConfigModule, IUserModuleService } from "@medusajs/framework/types";

jest.setTimeout(300000);
const keys = ["ONEC_EXCHANGE_ENABLED", "ONEC_EXCHANGE_USER", "ONEC_EXCHANGE_PASSWORD", "ONEC_EXCHANGE_STORAGE_DIR"] as const;

describe("native CommerceML dry-run transport", () => {
  medusaIntegrationTestRunner({ testSuite: ({ api, getContainer }) => {
    let root: string;
    let saved: Array<string | undefined> | undefined;
    const username = "isolated-http-exchange";
    const password = "isolated-http-exchange-password-longer-than-32-characters";
    beforeEach(async () => {
      saved = keys.map((key) => process.env[key]);
      root = await fs.mkdtemp(path.join(os.tmpdir(), "onec-native-http-"));
      Object.assign(process.env, { ONEC_EXCHANGE_ENABLED: "true", ONEC_EXCHANGE_USER: username, ONEC_EXCHANGE_PASSWORD: password, ONEC_EXCHANGE_STORAGE_DIR: root });
    });
    afterEach(async () => {
      const previous = saved;
      if (previous) keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
      if (root) await fs.rm(root, { recursive: true, force: true });
    });

    it("continues the deployed session format, preserves raw UTF-8 upload bytes and protects the admin journal", async () => {
      const token = "2".repeat(64);
      const id = createHash("sha256").update(token).digest("hex");
      const directory = path.join(root, id);
      const bytes = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><КоммерческаяИнформация ВерсияСхемы="2.10"><Каталог><Товары><Товар><Ид>isolated-native-http</Ид></Товар></Товары></Каталог></КоммерческаяИнформация>');
      const split = 97;
      await fs.mkdir(directory);
      await fs.writeFile(path.join(directory, "import.xml"), bytes.subarray(0, split));
      await fs.writeFile(path.join(directory, "session.json"), JSON.stringify({
        id, credentialVersion: createHash("sha256").update(username + "\0" + password).digest("hex"),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), initialized: true, complete: false,
        files: [{ name: "import.xml", bytes: split, status: "received" }],
      }));
      const cookie = { cookie: `mm_onec=${token}` };
      const base = "/integrations/onec?type=catalog";
      const anonymous = await api.get("/admin/onec-exchange", { validateStatus: () => true });
      expect(anonymous.status).toBe(401);
      const denied = await api.post(base + "&mode=file&filename=import.xml", bytes.subarray(split), {
        headers: { "content-type": "application/xml" }, validateStatus: () => true,
      });
      expect(denied.status).toBe(401);
      expect(await fs.readFile(path.join(directory, "import.xml"))).toEqual(bytes.subarray(0, split));
      await api.get(base + "&mode=init", { headers: cookie });
      await api.post(base + "&mode=file&filename=import.xml", bytes.subarray(split), { headers: { ...cookie, "content-type": "application/xml" } });
      await api.get(base + "&mode=import&filename=import.xml", { headers: cookie });
      await api.get(base + "&mode=complete", { headers: cookie });
      expect(await fs.readFile(path.join(directory, "import.xml"))).toEqual(bytes);
      const container = getContainer();
      const config = container.resolve<ConfigModule>(ContainerRegistrationKeys.CONFIG_MODULE);
      const users = container.resolve<IUserModuleService>(Modules.USER);
      const admin = await users.createUsers({ email: "onec-http-operator@example.test" });
      const jwt = generateJwtToken({ actor_id: admin.id, actor_type: "user", auth_identity_id: "isolated-onec-http-admin" }, { secret: config.projectConfig.http.jwtSecret, expiresIn: "5m" });
      const response = await api.get("/admin/onec-exchange", { headers: { authorization: `Bearer ${jwt}` } });
      expect(response.data.mode).toBe("dry_run");
      expect(response.data.sessions).toEqual([expect.objectContaining({ id, complete: true, files: [expect.objectContaining({
        name: "import.xml", status: "validated", sha256: createHash("sha256").update(bytes).digest("hex"),
        summary: { version: "2.10", products: 1, offers: 0, warehouseElements: 0, priceTypes: 0 },
      })] })]);
      expect(response.data.sessions[0]).not.toHaveProperty("credentialVersion");
    });
  } });
});
