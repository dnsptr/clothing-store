import Header from "@/components/Header";
import Hero from "@/components/Hero";
import RecommendationsSlider from "@/components/RecommendationsSlider";
import CollectionsSlider from "@/components/CollectionsSlider";
import PromoBanner from "@/components/PromoBanner";
import MaterialsSlider from "@/components/MaterialsSlider";
import StoresSlider from "@/components/StoresSlider";
import Footer from "@/components/Footer";
import { fetchHomeContent } from "@/lib/content";
import styles from "./page.module.css";

// Must be a literal: Next requires the segment value to be statically
// analysable. Matches CATALOG_REVALIDATE_SECONDS in lib/medusa.ts, so an edit
// made in the admin appears within the same window as a catalog change.
export const revalidate = 300;

export default async function Home() {
  const content = await fetchHomeContent();

  return (
    <>
      <Header />
      <main className={styles.homeMain}>
        {/* Fullscreen Hero Campaign */}
        <Hero slides={content.hero} />

        {/* Drag-to-scroll categories */}
        <RecommendationsSlider items={content.shortcuts} />

        {/* Drag-to-scroll collections (Образы) */}
        <CollectionsSlider />

        {/* Fullscreen seasonal Promo Banner */}
        <PromoBanner promo={content.promo} />

        <div className={styles.afterPromo}>
          {/* Drag-to-scroll materials philosophy */}
          <MaterialsSlider items={content.materials} />

          {/* Drag-to-scroll retail stores */}
          <StoresSlider items={content.stores} />
        </div>
      </main>
      <Footer />
    </>
  );
}
