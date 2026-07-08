import Header from "@/components/Header";
import Hero from "@/components/Hero";
import Collections from "@/components/Collections";
import ProductGrid from "@/components/ProductGrid";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <Collections />
        <ProductGrid />
      </main>
      <Footer />
    </>
  );
}

