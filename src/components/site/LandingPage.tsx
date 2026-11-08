"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PRODUCT_GROUPS, SITE_PRODUCTS, productFacts, type ProductGroup } from "@/config/siteProducts";
import { APP_URL, isSiteHost } from "@/config/site";
import { SiteAnalytics } from "@/components/site/SiteAnalytics";

/** Where this page's links go. On mavin.pk the site pages have clean
 * addresses and the app lives on app.mavin.pk; on the app's own address the
 * site is under /site and the app is here. Decided after mount (the server
 * renders the app-address links; only hrefs change). */
function useLinks() {
  // null until the browser knows its address: the server-rendered page (what
  // search engines read) links the app by its full address, which works anywhere.
  const [onSite, setOnSite] = useState<boolean | null>(null);
  useEffect(() => setOnSite(isSiteHost(window.location.host)), []);
  return {
    site: (path: string) => (onSite ? path : `/site${path}`),
    app: (path: string) => (onSite === false ? path : `${APP_URL}${path}`),
  };
}

/** Icon and accent per business type (tiles in the Solutions section). */
const TYPE_ICON: Record<string, string> = {
  retail_pharmacy: "💊", medical_store: "🩺", hospital_pharmacy: "🏥", general_store: "🛒", contractor: "🧾", restaurant: "🍽️",
  electronics_solar: "☀️", distributor: "🚚", mobile_shop: "📱", cloth_store: "👔", clinic: "👨‍⚕️", lab: "🧪", hospital: "🏨", banquet_hall: "🎉",
};
const GROUP_COLOR: Record<ProductGroup, string> = {
  Pharmacy: "#0b2a6b", Retail: "#1e88e5", Distribution: "#7c3aed", Healthcare: "#0d9488", "Food & Events": "#ea580c", "Contractor Billing": "#475569",
};

/** The landing page (www.mavin.pk and the app's address); src/app/page.tsx adds its metadata. */
export function LandingPage() {
  const [group, setGroup] = useState<ProductGroup | "All">("All");
  const link = useLinks();
  const solutions = SITE_PRODUCTS.filter((p) => group === "All" || p.group === group);
  return (
    <>
      <SiteAnalytics />
      <style>{`
        @keyframes float {
          0%,100%{transform:translateY(0);opacity:.5}
          50%{transform:translateY(-22px);opacity:.85}
        }
        @keyframes shimmer {
          0%{background-position:-200% center}
          100%{background-position:200% center}
        }
        @keyframes fadeUp {
          from{opacity:0;transform:translateY(28px)}
          to{opacity:1;transform:translateY(0)}
        }
        @keyframes pulse-ring {
          0%{transform:scale(1);opacity:.6}
          100%{transform:scale(1.75);opacity:0}
        }
        @keyframes slide-nav {
          from{opacity:0;transform:translateY(-12px)}
          to{opacity:1;transform:translateY(0)}
        }
        @keyframes badge-pulse {
          0%,100%{box-shadow:0 0 0 0 rgba(26,26,110,.18)}
          50%{box-shadow:0 0 0 7px rgba(26,26,110,.0)}
        }
        .shimmer-text {
          background:linear-gradient(90deg,#0b2a6b 0%,#1e88e5 30%,#0b2a6b 60%,#1e88e5 80%,#0b2a6b 100%);
          background-size:200% auto;
          -webkit-background-clip:text;
          background-clip:text;
          -webkit-text-fill-color:transparent;
          animation:shimmer 4s linear infinite;
        }
        .feature-card {
          background:#fff;
          border:1px solid #e2e8f0;
          border-radius:16px;
          padding:24px;
          transition:transform .22s ease,box-shadow .22s ease,border-color .22s ease;
        }
        .feature-card:hover {
          transform:translateY(-5px);
          box-shadow:0 12px 40px rgba(26,26,110,.1);
          border-color:#0b2a6b30;
        }
        .dl-btn {
          transition:transform .2s ease,box-shadow .2s ease;
          box-shadow:0 4px 24px rgba(26,26,110,.25);
        }
        .dl-btn:hover { transform:scale(1.04); box-shadow:0 8px 36px rgba(26,26,110,.35); }
        .sol-card {
          display:flex;flex-direction:column;height:100%;
          background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:22px;
          text-decoration:none;color:inherit;
          transition:transform .22s ease,box-shadow .22s ease,border-color .22s ease;
        }
        .sol-card:hover { transform:translateY(-4px); box-shadow:0 12px 36px rgba(26,26,110,.1); border-color:#1e88e555; }
        .sol-card:focus-visible, .sol-tab:focus-visible, .web-btn:focus-visible, .dl-btn:focus-visible { outline:2px solid #1e88e5; outline-offset:3px; }
        .sol-tab { border:1.5px solid #e2e8f0;background:#fff;color:#334155;border-radius:100px;padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer;transition:all .18s ease; }
        .sol-tab[aria-pressed="true"] { background:#0b2a6b;border-color:#0b2a6b;color:#fff; }
        .nav-link { color:#334155;text-decoration:none;font-size:14px;font-weight:600; }
        .nav-link:hover { color:#1e88e5; }
        @media (max-width:640px){ .nav-extra{display:none!important} }
        .web-btn { transition:background .2s ease,border-color .2s ease; }
        .web-btn:hover { background:#f1f5f9!important; border-color:#94a3b8!important; }
        .fi1{animation:fadeUp .7s ease-out .1s both}
        .fi2{animation:fadeUp .7s ease-out .25s both}
        .fi3{animation:fadeUp .7s ease-out .4s both}
        .fi4{animation:fadeUp .7s ease-out .55s both}
        .fi5{animation:fadeUp .7s ease-out .7s both}
        .nav-anim{animation:slide-nav .5s ease-out both}
        .particle{animation:float var(--dur) ease-in-out var(--del) infinite}
      `}</style>

      <div style={{background:"#f8fafc",minHeight:"100vh",color:"#0f172a",overflow:"hidden"}}>

        {/* ── subtle dot-grid backdrop ── */}
        <div style={{
          position:"fixed",inset:0,zIndex:0,
          backgroundImage:"radial-gradient(circle,#cbd5e1 1px,transparent 1px)",
          backgroundSize:"28px 28px",
          opacity:.5,
        }}/>

        {/* ── soft color orbs ── */}
        <div style={{position:"fixed",inset:0,zIndex:0,pointerEvents:"none",overflow:"hidden"}}>
          {([
            {s:500,x:0,y:-10,dur:"20s",del:"0s",c:"rgba(26,26,110,.07)"},
            {s:400,x:75,y:-5,dur:"24s",del:"3s",c:"rgba(30,136,229,.06)"},
            {s:350,x:60,y:60,dur:"18s",del:"1s",c:"rgba(26,26,110,.05)"},
            {s:300,x:10,y:75,dur:"26s",del:"5s",c:"rgba(30,136,229,.05)"},
          ] as const).map((p,i)=>(
            <div key={i} className="particle" style={{
              "--dur":p.dur,"--del":p.del,
              position:"absolute",
              width:p.s,height:p.s,
              left:`${p.x}%`,top:`${p.y}%`,
              borderRadius:"50%",
              background:`radial-gradient(circle,${p.c},transparent)`,
              filter:"blur(60px)",
            } as React.CSSProperties}/>
          ))}
        </div>

        <div style={{position:"relative",zIndex:1}}>

          {/* ══════════ NAVBAR ══════════ */}
          <nav className="nav-anim" style={{
            padding:"0 32px",height:64,
            display:"flex",justifyContent:"space-between",alignItems:"center",
            borderBottom:"1px solid #e2e8f0",
            background:"rgba(248,250,252,.9)",backdropFilter:"blur(16px)",
            position:"sticky",top:0,zIndex:100,
            boxShadow:"0 1px 12px rgba(0,0,0,.06)",
          }}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mavin-header.png" alt="MAVIN.pk" style={{height:"clamp(30px, 9vw, 40px)",width:"auto",maxWidth:"55vw",objectFit:"contain",flexShrink:1,minWidth:0}} />
            </div>
            <div style={{display:"flex",alignItems:"center",gap:22}}>
              <a href="#solutions" className="nav-link nav-extra">Solutions</a>
              <a href="#features" className="nav-link nav-extra">Features</a>
              <Link href={link.site("/demo")} className="nav-link nav-extra">Book a Demo</Link>
              <a href={link.app("/dashboard")} style={{
                padding:"8px clamp(12px, 4vw, 22px)",
                background:"#0b2a6b",
                borderRadius:9,color:"#fff",
                textDecoration:"none",fontSize:14,fontWeight:700,
                letterSpacing:"-.01em",
                boxShadow:"0 2px 10px rgba(26,26,110,.25)",
                whiteSpace:"nowrap",flexShrink:0,
              }}>Sign In →</a>
            </div>
          </nav>

          {/* ══════════ HERO ══════════ */}
          <section style={{
            minHeight:"calc(100vh - 64px)",
            display:"flex",flexDirection:"column",
            alignItems:"center",justifyContent:"center",
            padding:"80px 24px 60px",
            textAlign:"center",
          }}>

            {/* badge */}
            <div className="fi1" style={{
              display:"inline-flex",alignItems:"center",gap:8,
              padding:"6px 18px",borderRadius:100,
              fontSize:13,fontWeight:600,color:"#0b2a6b",
              marginBottom:28,border:"1.5px solid #0b2a6b30",
              background:"#0b2a6b08",
              animation:"badge-pulse 2.8s ease-in-out infinite",
            }}>
              <span style={{
                width:7,height:7,borderRadius:"50%",background:"#1e88e5",
                display:"inline-block",
                boxShadow:"0 0 8px rgba(30,136,229,.8)",
                animation:"pulse-ring 1.8s ease-out infinite",
              }}/>
              One Platform · {SITE_PRODUCTS.length} Business Solutions · FBR Digital Invoicing
            </div>

            {/* heading */}
            <h1 className="fi2" style={{
              fontSize:"clamp(36px,6vw,76px)",
              fontWeight:900,lineHeight:1.08,
              marginBottom:22,maxWidth:860,
              letterSpacing:"-.04em",
              color:"#0f172a",
            }}>
              Your Business Deserves{" "}<br/>
              <span style={{display:"inline-flex",alignItems:"center",gap:"0.25em",flexWrap:"wrap",justifyContent:"center"}}>
                <span className="shimmer-text">a Smart</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/muawin-logo.png" alt="معاون" width={800} height={322} style={{height:"1.25em",width:"auto",display:"inline-block",verticalAlign:"middle"}} />
              </span>
            </h1>

            {/* subtext */}
            <p className="fi3" style={{
              fontSize:"clamp(15px,2vw,18px)",
              color:"#64748b",
              maxWidth:520,lineHeight:1.75,marginBottom:44,
            }}>
              Billing, stock, purchasing &amp; accounts for pharmacies, stores, restaurants, distributors,
              clinics, hospitals, labs and more {"\u2014"} one platform built for Pakistani businesses.
            </p>

            {/* CTA row */}
            <div className="fi4" style={{display:"flex",gap:14,flexWrap:"wrap",justifyContent:"center",marginBottom:64}}>
              <a href="#solutions" className="dl-btn" style={{
                display:"inline-flex",alignItems:"center",gap:10,
                padding:"15px 30px",
                background:"linear-gradient(135deg,#0b2a6b 0%,#1565c0 100%)",
                borderRadius:13,color:"white",
                textDecoration:"none",fontSize:16,fontWeight:800,
                letterSpacing:"-.02em",
              }}>
                Find Your Solution ↓
              </a>
              <Link href={link.site("/demo")} className="dl-btn" style={{
                display:"inline-flex",alignItems:"center",gap:10,
                padding:"15px 30px",
                background:"linear-gradient(135deg,#16a34a 0%,#15803d 100%)",
                borderRadius:13,color:"white",
                textDecoration:"none",fontSize:16,fontWeight:800,
                letterSpacing:"-.02em",
              }}>
                Book a Free Demo
              </Link>
              <a href={link.app("/dashboard")} className="web-btn" style={{
                display:"inline-flex",alignItems:"center",gap:9,
                padding:"15px 30px",
                background:"#fff",
                border:"1.5px solid #e2e8f0",
                borderRadius:13,color:"#334155",
                textDecoration:"none",fontSize:16,fontWeight:700,
                letterSpacing:"-.01em",
                boxShadow:"0 2px 8px rgba(0,0,0,.06)",
              }}>
                🌐 Open Web App
              </a>
            </div>

            {/* stat pills */}
            <div className="fi5" style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center"}}>
              {[
                {v:String(SITE_PRODUCTS.length),l:"Business Types"},
                {v:"18+",l:"Modules"},
                {v:"Web",l:"Any Browser"},
                {v:"FBR",l:"Digital Invoicing"},
                {v:"Staff",l:"Roles & Permissions"},
              ].map((s,i)=>(
                <div key={i} style={{
                  padding:"8px 18px",
                  background:"#fff",
                  border:"1.5px solid #e2e8f0",
                  borderRadius:100,
                  display:"flex",gap:8,alignItems:"center",
                  boxShadow:"0 1px 4px rgba(0,0,0,.05)",
                }}>
                  <span style={{fontWeight:800,color:"#1e88e5",fontSize:14}}>{s.v}</span>
                  <span style={{fontSize:13,color:"#94a3b8"}}>{s.l}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ══════════ SOLUTIONS (one tile per business type) ══════════ */}
          <section id="solutions" style={{padding:"80px 24px",maxWidth:1200,margin:"0 auto",scrollMarginTop:72}}>
            <div style={{textAlign:"center",marginBottom:28}}>
              <h2 style={{fontSize:"clamp(26px,4vw,38px)",fontWeight:800,letterSpacing:"-.03em",marginBottom:10,color:"#0f172a"}}>
                A Solution for Your Business
              </h2>
              <p style={{color:"#64748b",fontSize:16,maxWidth:620,margin:"0 auto"}}>
                {SITE_PRODUCTS.length} ready-made setups on one platform. Each comes with the screens, stock rules and bills its business needs.
              </p>
            </div>

            <div role="group" aria-label="Filter by sector" style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center",marginBottom:28}}>
              {(["All", ...PRODUCT_GROUPS] as const).map((g) => (
                <button key={g} type="button" className="sol-tab" aria-pressed={group === g} onClick={() => setGroup(g)}>
                  {g}{g !== "All" && <span style={{opacity:.6,marginLeft:6}}>{SITE_PRODUCTS.filter((p) => p.group === g).length}</span>}
                </button>
              ))}
            </div>

            <ul style={{listStyle:"none",padding:0,margin:0,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(min(100%,300px),1fr))",gap:18}}>
              {solutions.map((p) => {
                const facts = productFacts(p);
                const color = GROUP_COLOR[p.group];
                return (
                  <li key={p.slug}>
                    <Link href={link.site(`/products/${p.slug}`)} className="sol-card">
                      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                        <span aria-hidden style={{
                          width:46,height:46,flexShrink:0,borderRadius:12,fontSize:22,
                          display:"flex",alignItems:"center",justifyContent:"center",
                          background:`${color}12`,border:`1.5px solid ${color}30`,
                        }}>{TYPE_ICON[p.typeId] ?? "🏷️"}</span>
                        <div style={{minWidth:0}}>
                          <p style={{fontSize:11,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color}}>{p.group}</p>
                          <h3 style={{fontSize:16,fontWeight:700,letterSpacing:"-.01em",color:"#0f172a"}}>{p.name}</h3>
                        </div>
                      </div>
                      <p style={{fontSize:13.5,color:"#475569",lineHeight:1.55,marginBottom:12}}>{p.headline}</p>
                      <ul style={{listStyle:"none",padding:0,margin:"0 0 14px",display:"flex",flexDirection:"column",gap:6}}>
                        {facts.mvp.slice(0, 5).map((f) => (
                          <li key={f} style={{display:"flex",gap:8,fontSize:13,color:"#334155",lineHeight:1.4}}>
                            <span aria-hidden style={{color:"#16a34a",fontWeight:800}}>✓</span>{f}
                          </li>
                        ))}
                      </ul>
                      {facts.planned.length > 0 && (
                        <p style={{fontSize:12,color:"#94a3b8",lineHeight:1.45,marginBottom:14}}>
                          Coming: {facts.planned.slice(0, 2).join(", ")}{facts.planned.length > 2 ? "…" : ""}
                        </p>
                      )}
                      <div style={{marginTop:"auto",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                        <span style={{fontSize:13,fontWeight:700,color:"#1e88e5"}}>See details →</span>
                        {p.cta === "pilot" && (
                          <span style={{fontSize:11,fontWeight:700,color:"#9a3412",background:"#ffedd5",borderRadius:100,padding:"3px 10px"}}>Pilot</span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* ══════════ FEATURES ══════════ */}
          <section id="features" style={{padding:"80px 24px",maxWidth:1200,margin:"0 auto",scrollMarginTop:72}}>
            <div style={{textAlign:"center",marginBottom:52}}>
              <h2 style={{fontSize:"clamp(26px,4vw,38px)",fontWeight:800,letterSpacing:"-.03em",marginBottom:10,color:"#0f172a"}}>
                Everything Your Business Needs
              </h2>
              <p style={{color:"#64748b",fontSize:16}}>
                Built for Pakistani businesses {"\u2014"} GST, WHT, stock tracking &amp; FBR digital invoicing
              </p>
            </div>
            <div style={{
              display:"grid",
              gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",
              gap:18,
            }}>
              {FEATURES.map((f,i)=>(
                <div key={i} className="feature-card">
                  <div style={{
                    width:46,height:46,
                    background:`${f.color}12`,
                    border:`1.5px solid ${f.color}30`,
                    borderRadius:12,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:21,marginBottom:14,
                  }}>{f.icon}</div>
                  <h3 style={{fontWeight:700,fontSize:16,marginBottom:7,letterSpacing:"-.01em",color:"#0f172a"}}>{f.title}</h3>
                  <p style={{fontSize:13.5,color:"#64748b",lineHeight:1.65}}>{f.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ══════════ DOWNLOAD CTA ══════════ */}
          <section style={{
            padding:"90px 24px",textAlign:"center",
            background:"linear-gradient(135deg,#0b2a6b08 0%,#1e88e508 100%)",
            borderTop:"1px solid #e2e8f0",
            borderBottom:"1px solid #e2e8f0",
          }}>
            <div style={{maxWidth:640,margin:"0 auto"}}>

              <div style={{position:"relative",display:"inline-flex",marginBottom:36}}>
                {[0,.5,1].map((d,i)=>(
                  <div key={i} style={{
                    position:"absolute",
                    inset:`${-12-(i*12)}px`,
                    borderRadius:"50%",
                    border:`2px solid rgba(26,26,110,${.2-(i*.06)})`,
                    animation:`pulse-ring 2.2s ease-out ${d}s infinite`,
                  }}/>
                ))}
                <div style={{
                  width:84,height:84,
                  background:"linear-gradient(135deg,#0b2a6b,#2d2d9f)",
                  borderRadius:"50%",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:34,
                  boxShadow:"0 8px 32px rgba(26,26,110,.35)",
                }}>🚀</div>
              </div>

              <h2 style={{
                fontSize:"clamp(26px,4vw,40px)",
                fontWeight:800,letterSpacing:"-.03em",marginBottom:12,color:"#0f172a",
              }}>
                Ready to Get Started?
              </h2>
              <p style={{color:"#64748b",fontSize:16,lineHeight:1.7,marginBottom:36}}>
                Tell us your business and how you bill today. We set up the right solution, import your products and train your staff.
              </p>

              <div style={{display:"flex",gap:14,flexWrap:"wrap",justifyContent:"center",marginBottom:16}}>
                <Link href={link.site("/demo")} className="dl-btn" style={{
                  display:"inline-flex",alignItems:"center",gap:12,
                  padding:"16px 32px",
                  background:"linear-gradient(135deg,#0b2a6b 0%,#1565c0 100%)",
                  borderRadius:14,color:"white",
                  textDecoration:"none",fontSize:16,fontWeight:800,
                  letterSpacing:"-.02em",
                }}>
                  Book a Free Demo
                </Link>
                <Link href={link.site("/contact")} className="web-btn" style={{
                  display:"inline-flex",alignItems:"center",gap:12,
                  padding:"16px 32px",
                  background:"#fff",border:"1.5px solid #e2e8f0",
                  borderRadius:14,color:"#334155",
                  textDecoration:"none",fontSize:16,fontWeight:700,
                  letterSpacing:"-.01em",
                }}>
                  Contact Us
                </Link>
              </div>

              <p style={{marginTop:4,fontSize:12.5,color:"#94a3b8",letterSpacing:".02em"}}>
                RUNS IN ANY MODERN BROWSER · FBR DIGITAL INVOICING · STAFF ROLES & PERMISSIONS
              </p>
            </div>
          </section>

          {/* ══════════ FOOTER ══════════ */}
          <footer style={{
            padding:"28px 24px",textAlign:"center",
            color:"#94a3b8",fontSize:13.5,
            display:"flex",flexDirection:"column",gap:6,alignItems:"center",
            background:"#fff",borderTop:"1px solid #e2e8f0",
          }}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/mavin-header.png" alt="MAVIN.pk" style={{height:28,width:"auto",objectFit:"contain"}} />
            </div>
            <p>© 2026 MAVIN.pk · Built for Pakistani Businesses</p>
            <p style={{fontSize:12,color:"#cbd5e1",letterSpacing:".01em"}}>
              Developed by <span style={{color:"#0b2a6b",fontWeight:600}}>HS Software and Technology</span>
            </p>
            <a href={link.app("/dashboard")} style={{color:"#1e88e5",textDecoration:"none",fontSize:13,fontWeight:600}}>
              Sign in to Web App →
            </a>
          </footer>

        </div>
      </div>
    </>
  );
}

const FEATURES = [
  {icon:"🧾",color:"#0b2a6b",title:"Point of Sale Invoicing",
   desc:"Keyboard-driven POS with F-key shortcuts, barcode scan, per-line discount, tax, bonus qty & credit/cash invoices."},
  {icon:"📦",color:"#3b82f6",title:"Inventory & Batch Tracking",
   desc:"Batch & expiry for medicines, serial & IMEI numbers for electronics and mobiles, low-stock warnings, multi-location stock."},
  {icon:"🛒",color:"#8b5cf6",title:"Purchase Management",
   desc:"Order-to-receipt workflow, supplier invoices, ST & WHT tax per line, purchase returns."},
  {icon:"👥",color:"#1e88e5",title:"Customers & Suppliers",
   desc:"Full ledger, receivables/payables, credit limits, outstanding aging, bulk SMS notifications."},
  {icon:"📊",color:"#ef4444",title:"Reports & Analytics",
   desc:"Profit/loss by product, category, customer & company. Tax, bonus-claim, trial balance, balance sheet."},
  {icon:"🏦",color:"#14b8a6",title:"Cash & Bank Management",
   desc:"Multi-bank accounts, cash register in/out, expense categories, salary with deductions."},
  {icon:"🏛️",color:"#1e88e5",title:"FBR Tax Compliance",
   desc:"GST, WHT & Further Tax per line item. SRO / PCT codes on products. Digital invoicing integration."},
  {icon:"☁️",color:"#6366f1",title:"Cloud Web App",
   desc:"Works in any modern browser. Your data stays in one place and is reachable from every counter, office and branch."},
  {icon:"🔐",color:"#ec4899",title:"Staff & Access Control",
   desc:"Role-based access per module, attendance tracking, salary management, employee ledger."},
];
