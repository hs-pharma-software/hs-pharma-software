"use client";

import Link from "next/link";
import { Bricolage_Grotesque } from "next/font/google";
import { ArrowDown, ArrowRight, Globe, Package, ReceiptText, Smartphone, WifiOff } from "lucide-react";
import { SITE_PRODUCTS } from "@/config/siteProducts";
import { ANDROID_RELEASE, androidSizeLabel } from "@/config/androidRelease";
import { WINDOWS_RELEASE, windowsSizeLabel } from "@/config/windowsRelease";
import { MEDICINE_CATALOGUE } from "@/config/medicineCatalogue";
import styles from "./Hero.module.css";

/** The headline's display face (self-hosted by Next at build time). */
const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["700", "800"], display: "swap" });

const WindowsIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15" fill="currentColor"><path d="M0 2.2 6.5 1.3v6.2H0zm7.3-1L16 0v7.5H7.3zM0 8.3h6.5v6.3L0 13.8zm7.3 0H16V16l-8.7-1.2z" /></svg>
);

/** The landing page's first screen: the headline, the two main actions, the
 * apps, and the tax systems MAVIN.pk connects to. */
export function Hero({ site, app }: { site: (path: string) => string; app: (path: string) => string }) {
  const stats: [string, string][] = [
    [String(SITE_PRODUCTS.length), "business types"],
    ...(MEDICINE_CATALOGUE.shared ? [[MEDICINE_CATALOGUE.count, "medicines added"] as [string, string]] : []),
    ["18+", "modules"],
    ["Web", "+ Windows + Android"],
  ];
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <p className={`${styles.badge} ${styles.rise}`}>
        <span className={styles.dot} aria-hidden="true" />
        Made for Pakistani businesses · {SITE_PRODUCTS.length} ready solutions
      </p>

      <h1 id="hero-title" className={`${styles.title} ${display.className}`}>
        <span className={styles.line}>POS and business software</span>{" "}
        <span className={styles.line}>
          for{" "}
          <span className={styles.keep}><span className={`${styles.chip} ${styles.billing}`}><ReceiptText aria-hidden="true" className={styles.chipIcon} />billing</span>,</span>{" "}
          <span className={`${styles.chip} ${styles.stock}`}><Package aria-hidden="true" className={styles.chipIcon} />stock</span>
        </span>{" "}
        <span className={styles.line}>and <span className={styles.gradient}>daily operations</span></span>{" "}
        <span className={styles.line}>
          in{" "}
          <span className={styles.pakistan}>
            Pakistan
            <svg aria-hidden="true" viewBox="0 0 300 24" preserveAspectRatio="none" className={styles.underline}>
              <path d="M4 17C62 7 142 3 296 11" pathLength="1" />
            </svg>
          </span>
          .
        </span>
      </h1>

      <p className={`${styles.lead} ${styles.rise} ${styles.d1}`}>
        Billing, stock, purchasing and accounts for pharmacies, stores, restaurants, distributors, clinics, hospitals, labs and more, on one platform.
      </p>

      <div className={`${styles.actions} ${styles.rise} ${styles.d2}`}>
        <Link href={site("/demo")} className={styles.primary}>
          Book a Free Demo <ArrowRight aria-hidden="true" size={18} />
        </Link>
        <a href="#solutions" className={styles.secondary}>
          Find Your Solution <ArrowDown aria-hidden="true" size={18} />
        </a>
      </div>

      <ul className={`${styles.apps} ${styles.rise} ${styles.d2}`}>
        <li>
          <Link href={site("/download#windows")} title={`${WINDOWS_RELEASE.appName} ${WINDOWS_RELEASE.versionName} · ${windowsSizeLabel()}`}>
            <WindowsIcon />Request for Windows
          </Link>
        </li>
        <li>
          <a href={ANDROID_RELEASE.path} download type="application/vnd.android.package-archive" title={`${ANDROID_RELEASE.appName} ${ANDROID_RELEASE.versionName} · ${androidSizeLabel()}`}>
            <Smartphone aria-hidden="true" size={15} />Download for Android
          </a>
        </li>
        <li>
          <a href={app("/dashboard")}><Globe aria-hidden="true" size={15} />Open Web App</a>
        </li>
      </ul>

      <div className={`${styles.trust} ${styles.rise} ${styles.d3}`}>
        <p>Connected with</p>
        <ul>
          <li>
            <Link href={site("/integrations")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/fbr-digital-invoicing.png" alt="FBR Digital Invoicing System" width={56} height={56} />
            </Link>
          </li>
          <li>
            <Link href={site("/integrations")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/pra-logo.jpg" alt="Punjab Revenue Authority (PRA)" width={119} height={50} />
            </Link>
          </li>
          <li className={styles.offline}><WifiOff aria-hidden="true" size={18} />Bills offline on Windows</li>
        </ul>
      </div>

      <dl className={`${styles.stats} ${styles.rise} ${styles.d3}`}>
        {stats.map(([value, label]) => (
          <div key={label}>
            <dt className={display.className}>{value}</dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
