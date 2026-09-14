import Header from "../../../components/Header";
import Footer from "../../../components/Footer";
import PaymentReturnClient from "../PaymentReturnClient";
import styles from "../checkout.module.css";

export const metadata = {
  title: "Статус оплаты | Mario Mikke",
  robots: { index: false, follow: false },
};

export default function CheckoutFailPage() {
  return (
    <div className={styles.page}>
      <Header />
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Статус оплаты</h1>
      </div>
      <PaymentReturnClient />
      <Footer />
    </div>
  );
}
