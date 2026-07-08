import Header from "@/components/Header";
import Hero from "@/components/Hero";
import RecommendationsSlider from "@/components/RecommendationsSlider";
import CollectionsSlider from "@/components/CollectionsSlider";
import PromoBanner from "@/components/PromoBanner";
import MaterialsSlider from "@/components/MaterialsSlider";
import StoresSlider from "@/components/StoresSlider";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        {/* Fullscreen Hero Campaign */}
        <Hero />

        {/* Drag-to-scroll categories */}
        <RecommendationsSlider />

        {/* Drag-to-scroll collections (Образы) */}
        <CollectionsSlider />

        {/* Fullscreen seasonal Promo Banner */}
        <PromoBanner />

        {/* Drag-to-scroll materials philosophy */}
        <MaterialsSlider />

        {/* Drag-to-scroll retail stores */}
        <StoresSlider />
      </main>
      <Footer />
    </>
  );
}
