import { unstable_rethrow } from "next/navigation";
import { isMedusaConfigured, medusaRequest, MedusaRequestError } from "./medusa";
import { DEFAULT_SITE_CONTENT } from "./siteContentDefaults";
import { parseSiteContent, type SiteContent } from "./site-content-contract";

export async function getSiteContent(signal?: AbortSignal): Promise<SiteContent> {
  if (!isMedusaConfigured) return DEFAULT_SITE_CONTENT;
  try {
    const response = await medusaRequest<{ content: unknown }>("/store/content/site", { revalidate: 0, signal });
    return response.content === null ? DEFAULT_SITE_CONTENT : parseSiteContent(response.content);
  } catch (error) {
    unstable_rethrow(error);
    // Before the CMS backend is deployed the static pages remain available.
    // A deployed endpoint failure must not silently replace published terms.
    if (error instanceof MedusaRequestError && error.status === 404) return DEFAULT_SITE_CONTENT;
    throw error;
  }
}
