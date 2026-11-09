import fs from "node:fs/promises";
import path from "node:path";

// A narrow release on top of the verified payment image. Build backend first.
const output = path.resolve(".env-catalog-release");
const compiled = path.resolve("medusa-prototype/apps/backend/.medusa/server");
const files = [
  "src/api/admin/catalog-profile-guard.js",
  "src/api/admin/catalog-quality/route.js",
  "src/lib/catalog-profile.js", "src/lib/catalog-quality.js", "src/lib/catalog-preview.js",
  "src/workflows/hooks/catalog-preview.js",
];
for (const file of files) {
  const target=path.join(output,"patch",file);
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.copyFile(path.join(compiled,file),target);
}
await fs.cp(path.join(compiled,"public/admin"),path.join(output,"patch/public/admin"),{recursive:true});
console.log(`Prepared ${files.length} backend files and built admin assets in ${output}`);
