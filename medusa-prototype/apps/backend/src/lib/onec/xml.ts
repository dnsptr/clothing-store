import { SaxesParser } from "saxes";

export type CommerceSummary = {
  version: string;
  products: number;
  offers: number;
  warehouseElements: number;
  priceTypes: number;
};

export function decodeCommerceXml(bytes: Buffer): string {
  // Inspect the ASCII declaration before decoding legacy Windows-1251 files.
  const declaration = bytes.subarray(0, 256).toString("ascii");
  const encoding = /encoding\s*=\s*["']([^"']+)["']/i.exec(declaration)?.[1]?.toLowerCase() || "utf-8";
  if (!["utf-8", "utf8", "windows-1251"].includes(encoding)) throw new Error("Unsupported XML encoding");
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

export function inspectCommerceXml(bytes: Buffer): CommerceSummary {
  const xml = decodeCommerceXml(bytes);
  const summary: CommerceSummary = { version: "", products: 0, offers: 0, warehouseElements: 0, priceTypes: 0 };
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  let root = false;
  parser.on("doctype", () => { throw new Error("DTD is forbidden"); });
  parser.on("opentag", (tag) => {
    if (++depth > 64) throw new Error("XML is too deeply nested");
    if (!root) {
      root = true;
      if (tag.local !== "КоммерческаяИнформация") throw new Error("Not a CommerceML document");
      const version = Object.values(tag.attributes).find((attribute) => attribute.local === "ВерсияСхемы")?.value || "";
      if (!/^2\.\d{1,3}$/.test(version)) throw new Error("Unsupported CommerceML version");
      summary.version = version;
    }
    if (tag.local === "Товар") summary.products++;
    if (tag.local === "Предложение") summary.offers++;
    if (tag.local === "Склад") summary.warehouseElements++;
    if (tag.local === "ТипЦены") summary.priceTypes++;
  });
  parser.on("closetag", () => { depth--; });
  parser.write(xml).close();
  if (!root) throw new Error("Empty XML");
  return summary;
}
