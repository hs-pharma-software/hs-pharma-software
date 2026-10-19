"use client";

import Link from "next/link";

export default function LandingPage() {
  return (
    <>
      <style>{`
        @keyframes float {
          0%,100%{transform:translateY(0) rotate(0deg);opacity:.5}
          50%{transform:translateY(-28px) rotate(4deg);opacity:.9}
        }
        @keyframes glow-pulse {
          0%,100%{box-shadow:0 0 20px rgba(16,185,129,.35),0 0 60px rgba(16,185,129,.15)}
          50%{box-shadow:0 0 40px rgba(16,185,129,.6),0 0 100px rgba(16,185,129,.25)}
        }
        @keyframes shimmer {
          0%{background-position:-200% center}
          100%{background-position:200% center}
        }
        @keyframes fadeUp {
          from{opacity:0;transform:translateY(32px)}
          to{opacity:1;transform:translateY(0)}
        }
        @keyframes pulse-ring {
          0%{transform:scale(1);opacity:.7}
          100%{transform:scale(1.7);opacity:0}
        }
        @keyframes slide-nav {
          from{opacity:0;transform:translateY(-16px)}
          to{opacity:1;transform:translateY(0)}
        }
        @keyframes spin-slow {
          from{transform:rotate(0deg)}
          to{transform:rotate(360deg)}
        }
        @keyframes badge-glow {
          0%,100%{border-color:rgba(16,185,129,.35);background:rgba(16,185,129,.08)}
          50%{border-color:rgba(16,185,129,.7);background:rgba(16,185,129,.15)}
        }
        .shimmer-text {
          background:linear-gradient(90deg,#10b981 0%,#34d399 20%,#f59e0b 50%,#34d399 80%,#10b981 100%);
          background-size:200% auto;
          -webkit-background-clip:text;
          background-clip:text;
          -webkit-text-fill-color:transparent;
          animation:shimmer 3.5s linear infinite;
        }
        .glass-card {
          background:rgba(255,255,255,.04);
          backdrop-filter:blur(12px);
          border:1px solid rgba(255,255,255,.09);
          transition:transform .25s ease,border-color .25s ease,background .25s ease;
        }
        .glass-card:hover {
          transform:translateY(-4px);
          border-color:rgba(16,185,129,.35);
          background:rgba(16,185,129,.06);
        }
        .dl-btn {
          animation:glow-pulse 2.5s ease-in-out infinite;
          transition:transform .2s ease,filter .2s ease;
        }
        .dl-btn:hover { transform:scale(1.04); filter:brightness(1.1); }
        .web-btn { transition:background .2s ease,border-color .2s ease; }
        .web-btn:hover { background:rgba(255,255,255,.13)!important; border-color:rgba(255,255,255,.35)!important; }
        .fi1{animation:fadeUp .8s ease-out .1s both}
        .fi2{animation:fadeUp .8s ease-out .3s both}
        .fi3{animation:fadeUp .8s ease-out .5s both}
        .fi4{animation:fadeUp .8s ease-out .7s both}
        .fi5{animation:fadeUp .8s ease-out .9s both}
        .nav-anim{animation:slide-nav .6s ease-out both}
        .badge-anim{animation:badge-glow 2.5s ease-in-out infinite}
        .particle{animation:float var(--dur) ease-in-out var(--del) infinite}
      `}</style>

      <div style={{background:"#05080f",minHeight:"100vh",color:"#f8fafc",overflow:"hidden"}}>

        {/* ── grid backdrop ── */}
        <div style={{
          position:"fixed",inset:0,zIndex:0,
          backgroundImage:"linear-gradient(rgba(16,185,129,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(16,185,129,.04) 1px,transparent 1px)",
          backgroundSize:"64px 64px",
          maskImage:"radial-gradient(ellipse 80% 60% at 50% 50%,black 30%,transparent 100%)",
        }}/>

        {/* ── floating orbs ── */}
        <div style={{position:"fixed",inset:0,zIndex:0,pointerEvents:"none",overflow:"hidden"}}>
          {([
            {s:300,x:5,y:10,dur:"18s",del:"0s",c:"rgba(16,185,129,.1)"},
            {s:200,x:80,y:5,dur:"22s",del:"3s",c:"rgba(245,158,11,.07)"},
            {s:250,x:65,y:55,dur:"16s",del:"1s",c:"rgba(16,185,129,.08)"},
            {s:180,x:20,y:70,dur:"24s",del:"4s",c:"rgba(245,158,11,.06)"},
            {s:220,x:88,y:75,dur:"20s",del:"2s",c:"rgba(99,102,241,.08)"},
            {s:150,x:45,y:85,dur:"14s",del:"5s",c:"rgba(16,185,129,.06)"},
          ] as const).map((p,i)=>(
            <div key={i} className="particle" style={{
              "--dur":p.dur,"--del":p.del,
              position:"absolute",
              width:p.s,height:p.s,
              left:`${p.x}%`,top:`${p.y}%`,
              borderRadius:"50%",
              background:`radial-gradient(circle,${p.c},transparent)`,
              filter:"blur(40px)",
            } as React.CSSProperties}/>
          ))}
        </div>

        <div style={{position:"relative",zIndex:1}}>

          {/* ══════════ NAVBAR ══════════ */}
          <nav className="nav-anim" style={{
            padding:"0 32px",height:64,
            display:"flex",justifyContent:"space-between",alignItems:"center",
            borderBottom:"1px solid rgba(255,255,255,.07)",
            background:"rgba(5,8,15,.75)",backdropFilter:"blur(16px)",
            position:"sticky",top:0,zIndex:100,
          }}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{
                width:38,height:38,
                background:"linear-gradient(135deg,#10b981,#059669)",
                borderRadius:11,display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:20,flexShrink:0,
                boxShadow:"0 0 16px rgba(16,185,129,.4)",
              }}>💊</div>
              <span style={{fontWeight:800,fontSize:17,letterSpacing:"-.02em"}}>
                eSales <span style={{color:"#10b981"}}>Pharmacy</span>
              </span>
            </div>
            <Link href="/dashboard" style={{
              padding:"8px 22px",
              background:"rgba(16,185,129,.12)",
              border:"1px solid rgba(16,185,129,.35)",
              borderRadius:9,color:"#34d399",
              textDecoration:"none",fontSize:14,fontWeight:700,
              letterSpacing:"-.01em",
            }}>Sign In →</Link>
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
            <div className="fi1 badge-anim" style={{
              display:"inline-flex",alignItems:"center",gap:8,
              padding:"6px 18px",borderRadius:100,
              fontSize:13,fontWeight:600,color:"#34d399",
              marginBottom:28,border:"1px solid",
            }}>
              <span style={{
                width:7,height:7,borderRadius:"50%",background:"#10b981",
                display:"inline-block",
                boxShadow:"0 0 8px rgba(16,185,129,.9)",
                animation:"pulse-ring 1.8s ease-out infinite",
              }}/>
              Offline-First · Cloud-Synced · FBR Ready
            </div>

            {/* heading */}
            <h1 className="fi2" style={{
              fontSize:"clamp(38px,6.5vw,80px)",
              fontWeight:900,lineHeight:1.08,
              marginBottom:22,maxWidth:860,
              letterSpacing:"-.04em",
            }}>
              Manage Your Pharmacy<br/>
              <span className="shimmer-text">Like Never Before</span>
            </h1>

            {/* subtext */}
            <p className="fi3" style={{
              fontSize:"clamp(15px,2vw,18px)",
              color:"rgba(248,250,252,.55)",
              maxWidth:520,lineHeight:1.75,marginBottom:44,
            }}>
              Complete POS, inventory, invoicing, purchasing &amp; accounting —
              in one powerful desktop app for Pakistani pharmacies.
            </p>

            {/* CTA row */}
            <div className="fi4" style={{display:"flex",gap:14,flexWrap:"wrap",justifyContent:"center",marginBottom:64}}>

              {/* primary download */}
              <a
                href="https://github.com/hs-pharma-software/hs-pharma-software/releases/latest"
                target="_blank" rel="noopener noreferrer"
                className="dl-btn"
                style={{
                  display:"inline-flex",alignItems:"center",gap:10,
                  padding:"15px 30px",
                  background:"linear-gradient(135deg,#10b981 0%,#059669 100%)",
                  borderRadius:13,color:"white",
                  textDecoration:"none",fontSize:16,fontWeight:800,
                  letterSpacing:"-.02em",
                }}
              >
                <WinIcon size={20}/>
                Download for Windows
                <span style={{
                  fontSize:11,fontWeight:700,
                  background:"rgba(0,0,0,.25)",
                  padding:"2px 9px",borderRadius:5,letterSpacing:".05em",
                }}>FREE</span>
              </a>

              {/* secondary web app */}
              <Link href="/dashboard" className="web-btn" style={{
                display:"inline-flex",alignItems:"center",gap:9,
                padding:"15px 30px",
                background:"rgba(255,255,255,.07)",
                border:"1px solid rgba(255,255,255,.14)",
                borderRadius:13,color:"rgba(248,250,252,.85)",
                textDecoration:"none",fontSize:16,fontWeight:700,
                letterSpacing:"-.01em",
              }}>
                🌐 Open Web App
              </Link>
            </div>

            {/* stat pills */}
            <div className="fi5" style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center"}}>
              {[
                {v:"18+",l:"Modules"},
                {v:"12+",l:"Reports"},
                {v:"Win 10/11",l:"Platform"},
                {v:"FBR",l:"Compliant"},
                {v:"Offline",l:"First"},
              ].map((s,i)=>(
                <div key={i} style={{
                  padding:"8px 18px",
                  background:"rgba(255,255,255,.05)",
                  border:"1px solid rgba(255,255,255,.08)",
                  borderRadius:100,
                  display:"flex",gap:8,alignItems:"center",
                }}>
                  <span style={{fontWeight:800,color:"#10b981",fontSize:14}}>{s.v}</span>
                  <span style={{fontSize:13,color:"rgba(255,255,255,.4)"}}>{s.l}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ══════════ FEATURES ══════════ */}
          <section style={{padding:"80px 24px",maxWidth:1200,margin:"0 auto"}}>
            <div style={{textAlign:"center",marginBottom:52}}>
              <h2 style={{fontSize:"clamp(26px,4vw,38px)",fontWeight:800,letterSpacing:"-.03em",marginBottom:10}}>
                Everything Your Pharmacy Needs
              </h2>
              <p style={{color:"rgba(255,255,255,.45)",fontSize:16}}>
                Built for Pakistani pharmacies — GST, WHT, batch tracking &amp; FBR digital invoicing
              </p>
            </div>
            <div style={{
              display:"grid",
              gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",
              gap:18,
            }}>
              {FEATURES.map((f,i)=>(
                <div key={i} className="glass-card" style={{padding:"22px 24px",borderRadius:16}}>
                  <div style={{
                    width:46,height:46,
                    background:`${f.color}18`,
                    border:`1px solid ${f.color}35`,
                    borderRadius:12,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:21,marginBottom:14,
                  }}>{f.icon}</div>
                  <h3 style={{fontWeight:700,fontSize:16,marginBottom:7,letterSpacing:"-.01em"}}>{f.title}</h3>
                  <p style={{fontSize:13.5,color:"rgba(255,255,255,.45)",lineHeight:1.65}}>{f.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ══════════ DOWNLOAD CTA ══════════ */}
          <section style={{
            padding:"90px 24px",textAlign:"center",
            background:"linear-gradient(180deg,transparent,rgba(16,185,129,.04),transparent)",
            borderTop:"1px solid rgba(255,255,255,.05)",
            borderBottom:"1px solid rgba(255,255,255,.05)",
          }}>
            <div style={{maxWidth:580,margin:"0 auto"}}>

              {/* pulsing icon */}
              <div style={{position:"relative",display:"inline-flex",marginBottom:36}}>
                {[0,.5,1].map((d,i)=>(
                  <div key={i} style={{
                    position:"absolute",
                    inset:`${-12-(i*12)}px`,
                    borderRadius:"50%",
                    border:`2px solid rgba(16,185,129,${.35-(i*.1)})`,
                    animation:`pulse-ring 2.2s ease-out ${d}s infinite`,
                  }}/>
                ))}
                <div style={{
                  width:84,height:84,
                  background:"linear-gradient(135deg,#10b981,#059669)",
                  borderRadius:"50%",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:34,
                  boxShadow:"0 0 40px rgba(16,185,129,.5)",
                }}>⬇</div>
              </div>

              <h2 style={{
                fontSize:"clamp(26px,4vw,40px)",
                fontWeight:800,letterSpacing:"-.03em",marginBottom:12,
              }}>
                Ready to Get Started?
              </h2>
              <p style={{color:"rgba(255,255,255,.45)",fontSize:16,lineHeight:1.7,marginBottom:36}}>
                Download once, run forever. Works fully offline.
                Syncs to cloud automatically when internet is available.
              </p>

              <a
                href="https://github.com/hs-pharma-software/hs-pharma-software/releases/latest"
                target="_blank" rel="noopener noreferrer"
                className="dl-btn"
                style={{
                  display:"inline-flex",alignItems:"center",gap:12,
                  padding:"18px 44px",
                  background:"linear-gradient(135deg,#10b981 0%,#059669 100%)",
                  borderRadius:14,color:"white",
                  textDecoration:"none",fontSize:17,fontWeight:800,
                  letterSpacing:"-.02em",
                }}
              >
                <WinIcon size={22}/>
                Download for Windows (.exe)
              </a>

              <p style={{marginTop:14,fontSize:12.5,color:"rgba(255,255,255,.25)",letterSpacing:".02em"}}>
                WINDOWS 10 / 11 · 64-BIT · FREE TO DOWNLOAD
              </p>
            </div>
          </section>

          {/* ══════════ FOOTER ══════════ */}
          <footer style={{
            padding:"28px 24px",textAlign:"center",
            color:"rgba(255,255,255,.25)",fontSize:13.5,
            display:"flex",flexDirection:"column",gap:6,alignItems:"center",
          }}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <div style={{
                width:24,height:24,
                background:"linear-gradient(135deg,#10b981,#059669)",
                borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:13,
              }}>💊</div>
              <span style={{fontWeight:700,color:"rgba(255,255,255,.4)"}}>eSales Pharmacy</span>
            </div>
            <p>© 2026 eSales Pharmacy · Built for Pakistani Pharmacies · Version 2026</p>
            <Link href="/dashboard" style={{color:"rgba(16,185,129,.6)",textDecoration:"none",fontSize:13}}>
              Sign in to Web App →
            </Link>
          </footer>

        </div>
      </div>
    </>
  );
}

function WinIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.951-1.8"/>
    </svg>
  );
}

const FEATURES = [
  {icon:"🧾",color:"#10b981",title:"Point of Sale Invoicing",
   desc:"Keyboard-driven POS with F-key shortcuts, barcode scan, per-line discount, tax, bonus qty & credit/cash invoices."},
  {icon:"📦",color:"#3b82f6",title:"Inventory & Batch Tracking",
   desc:"Batch numbers, expiry dates, FEFO alerts, low-stock warnings, multi-location stock transfers."},
  {icon:"🛒",color:"#8b5cf6",title:"Purchase Management",
   desc:"Order-to-receipt workflow, supplier invoices, ST & WHT tax per line, purchase returns."},
  {icon:"👥",color:"#f59e0b",title:"Customers & Suppliers",
   desc:"Full ledger, receivables/payables, credit limits, outstanding aging, bulk SMS notifications."},
  {icon:"📊",color:"#ef4444",title:"Reports & Analytics",
   desc:"Profit/loss by product, category, customer & company. Tax, bonus-claim, trial balance, balance sheet."},
  {icon:"🏦",color:"#14b8a6",title:"Cash & Bank Management",
   desc:"Multi-bank accounts, cash register in/out, expense categories, salary with deductions."},
  {icon:"🏛️",color:"#f97316",title:"FBR Tax Compliance",
   desc:"GST, WHT & Further Tax per line item. SRO / PCT codes on products. Digital invoicing integration."},
  {icon:"☁️",color:"#6366f1",title:"Offline-First + Cloud Sync",
   desc:"Runs without internet, syncs automatically to cloud. Accessible as a web app from anywhere."},
  {icon:"🔐",color:"#ec4899",title:"Staff & Access Control",
   desc:"Role-based access per module, attendance tracking, salary management, employee ledger."},
];
