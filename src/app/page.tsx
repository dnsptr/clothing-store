import Header from "@/components/Header";
import Hero from "@/components/Hero";
import RecommendationsSlider from "@/components/RecommendationsSlider";
import ProductGrid from "@/components/ProductGrid";
import CollectionsSlider from "@/components/CollectionsSlider";
import PromoBanner from "@/components/PromoBanner";
import MaterialsSlider from "@/components/MaterialsSlider";
import StoresSlider from "@/components/StoresSlider";
import Footer from "@/components/Footer";
import styles from "./page.module.css";

export default function Home() {
  return (
    <>
      <Header />
      <main className={styles.homeMain}>
        {/* Fullscreen Hero Campaign */}
        <Hero />

        {/* Drag-to-scroll categories */}
        <RecommendationsSlider />

        {/* Own product cards */}
        {/* <ProductGrid /> */}

        {/* Drag-to-scroll collections (Образы) */}
        <CollectionsSlider />

        {/* Fullscreen seasonal Promo Banner */}
        <PromoBanner />

        <div className={styles.afterPromo}>
          {/* Drag-to-scroll materials philosophy */}
          <MaterialsSlider />

          {/* Drag-to-scroll retail stores */}
          <StoresSlider />
        </div>
      </main>
      <Footer />
    </>
  );
}
