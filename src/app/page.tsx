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
