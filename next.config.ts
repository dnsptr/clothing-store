import type { NextConfig } from "next";

const githubPagesBasePath =
  process.env.NEXT_PUBLIC_BASE_PATH ??
  (process.env.GITHUB_ACTIONS === "true" ? "/clothing-store" : "");

if (
  process.env.NEXT_PUBLIC_DATA_MODE === "medusa" &&
  (!process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    !process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY)
) {
  throw new Error(
    "Medusa mode requires NEXT_PUBLIC_MEDUSA_BACKEND_URL and " +
      "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY at build time.",
  );
}

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  basePath: githubPagesBasePath || undefined,
  assetPrefix: githubPagesBasePath || undefined,
  env: {
    NEXT_PUBLIC_BASE_PATH: githubPagesBasePath,
  },
};

export default nextConfig;
