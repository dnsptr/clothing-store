import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const source = process.argv[2];
const output = process.argv[3] || ".env-catalog-media";
if (!source) throw new Error("Pass the extracted directory containing article-number folders");
const target = path.join(output, "optimized");
await fs.mkdir(target, { recursive: true });
const manifest = [];
for (const entry of (await fs.readdir(source, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory() || !/^\d+(?:-\d+)?$/.test(entry.name)) continue;
  const article=entry.name;
  const files = (await fs.readdir(path.join(source,article))).filter(name => /\.(jpg|jpeg|png)$/i.test(name)).sort((a,b) => {
    const rank = name => Number(name.match(/-(\d+)\.png$/)?.[1] ?? 99);
    return rank(a)-rank(b) || a.localeCompare(b);
  });
  const images=[];
  for (const [index,name] of files.entries()) {
    const file=path.join(target,`${article}-${index+1}.webp`);
    await sharp(path.join(source,article,name)).rotate().resize({width:1600,height:2000,fit:"inside",withoutEnlargement:true}).webp({quality:85}).toFile(file);
    images.push({file,source:name,bytes:(await fs.stat(file)).size});
  }
  if (images.length) manifest.push({article,images});
}
await fs.writeFile(path.join(output,"manifest.json"),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({articles:manifest.length,photos:manifest.flatMap(item=>item.images).length,bytes:manifest.flatMap(item=>item.images).reduce((sum,image)=>sum+image.bytes,0)}));
