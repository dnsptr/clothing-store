import Header from "../../components/Header";
import Footer from "../../components/Footer";
import CheckoutClient from "./CheckoutClient";
import styles from "./checkout.module.css";

export default function CheckoutPage() {
  return (
    <div className={styles.page}>
      <Header />
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Оформление заказа</h1>
      </div>
      <CheckoutClient />
      <Footer />
    </div>
  );
}
