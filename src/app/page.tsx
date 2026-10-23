"use client";

import Link from "next/link";

export default function LandingPage() {
  return (
    <>
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
          background:linear-gradient(90deg,#1a1a6e 0%,#f97316 30%,#1a1a6e 60%,#f97316 80%,#1a1a6e 100%);
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
          border-color:#1a1a6e30;
        }
        .dl-btn {
          transition:transform .2s ease,box-shadow .2s ease;
          box-shadow:0 4px 24px rgba(26,26,110,.25);
        }
        .dl-btn:hover { transform:scale(1.04); box-shadow:0 8px 36px rgba(26,26,110,.35); }
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
            {s:400,x:75,y:-5,dur:"24s",del:"3s",c:"rgba(249,115,22,.06)"},
            {s:350,x:60,y:60,dur:"18s",del:"1s",c:"rgba(26,26,110,.05)"},
            {s:300,x:10,y:75,dur:"26s",del:"5s",c:"rgba(249,115,22,.05)"},
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
              <img src="/logo.png" alt="Billora" style={{width:36,height:36,objectFit:"contain",flexShrink:0}} />
              <span style={{fontWeight:800,fontSize:18,letterSpacing:"-.02em",color:"#1a1a6e"}}>
                Billora
              </span>
            </div>
            <Link href="/dashboard" style={{
              padding:"8px 22px",
              background:"#1a1a6e",
              borderRadius:9,color:"#fff",
              textDecoration:"none",fontSize:14,fontWeight:700,
              letterSpacing:"-.01em",
              boxShadow:"0 2px 10px rgba(26,26,110,.25)",
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
            <div className="fi1" style={{
              display:"inline-flex",alignItems:"center",gap:8,
              padding:"6px 18px",borderRadius:100,
              fontSize:13,fontWeight:600,color:"#1a1a6e",
              marginBottom:28,border:"1.5px solid #1a1a6e30",
              background:"#1a1a6e08",
              animation:"badge-pulse 2.8s ease-in-out infinite",
            }}>
              <span style={{
                width:7,height:7,borderRadius:"50%",background:"#f97316",
                display:"inline-block",
                boxShadow:"0 0 8px rgba(249,115,22,.8)",
                animation:"pulse-ring 1.8s ease-out infinite",
              }}/>
              Offline-First · Cloud-Synced · FBR Ready
            </div>

            {/* heading */}
            <h1 className="fi2" style={{
              fontSize:"clamp(36px,6vw,76px)",
              fontWeight:900,lineHeight:1.08,
              marginBottom:22,maxWidth:860,
              letterSpacing:"-.04em",
              color:"#0f172a",
            }}>
              Manage Your Pharmacy<br/>
              <span className="shimmer-text">Like Never Before</span>
            </h1>

            {/* subtext */}
            <p className="fi3" style={{
              fontSize:"clamp(15px,2vw,18px)",
              color:"#64748b",
              maxWidth:520,lineHeight:1.75,marginBottom:44,
            }}>
              Complete POS, inventory, invoicing, purchasing &amp; accounting {"\u2014"}
              in one powerful desktop app for Pakistani pharmacies.
            </p>

            {/* CTA row */}
            <div className="fi4" style={{display:"flex",gap:14,flexWrap:"wrap",justifyContent:"center",marginBottom:64}}>

              <a
                href="https://github.com/hs-pharma-software/hs-pharma-software/releases/latest/download/Billora_0.1.1_x64-setup.exe"
                className="dl-btn"
                style={{
                  display:"inline-flex",alignItems:"center",gap:10,
                  padding:"15px 30px",
                  background:"linear-gradient(135deg,#1a1a6e 0%,#2d2d9f 100%)",
                  borderRadius:13,color:"white",
                  textDecoration:"none",fontSize:16,fontWeight:800,
                  letterSpacing:"-.02em",
                }}
              >
                <WinIcon size={20}/>
                Download for Windows
                <span style={{
                  fontSize:11,fontWeight:700,
                  background:"rgba(255,255,255,.2)",
                  padding:"2px 9px",borderRadius:5,letterSpacing:".05em",
                }}>FREE</span>
              </a>

              <Link href="/dashboard" className="web-btn" style={{
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
                  background:"#fff",
                  border:"1.5px solid #e2e8f0",
                  borderRadius:100,
                  display:"flex",gap:8,alignItems:"center",
                  boxShadow:"0 1px 4px rgba(0,0,0,.05)",
                }}>
                  <span style={{fontWeight:800,color:"#f97316",fontSize:14}}>{s.v}</span>
                  <span style={{fontSize:13,color:"#94a3b8"}}>{s.l}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ══════════ FEATURES ══════════ */}
          <section style={{padding:"80px 24px",maxWidth:1200,margin:"0 auto"}}>
            <div style={{textAlign:"center",marginBottom:52}}>
              <h2 style={{fontSize:"clamp(26px,4vw,38px)",fontWeight:800,letterSpacing:"-.03em",marginBottom:10,color:"#0f172a"}}>
                Everything Your Pharmacy Needs
              </h2>
              <p style={{color:"#64748b",fontSize:16}}>
                Built for Pakistani pharmacies {"\u2014"} GST, WHT, batch tracking &amp; FBR digital invoicing
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
            background:"linear-gradient(135deg,#1a1a6e08 0%,#f9731608 100%)",
            borderTop:"1px solid #e2e8f0",
            borderBottom:"1px solid #e2e8f0",
          }}>
            <div style={{maxWidth:580,margin:"0 auto"}}>

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
                  background:"linear-gradient(135deg,#1a1a6e,#2d2d9f)",
                  borderRadius:"50%",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:34,
                  boxShadow:"0 8px 32px rgba(26,26,110,.35)",
                }}>⬇</div>
              </div>

              <h2 style={{
                fontSize:"clamp(26px,4vw,40px)",
                fontWeight:800,letterSpacing:"-.03em",marginBottom:12,color:"#0f172a",
              }}>
                Ready to Get Started?
              </h2>
              <p style={{color:"#64748b",fontSize:16,lineHeight:1.7,marginBottom:36}}>
                Download once, run forever. Works fully offline.
                Syncs to cloud automatically when internet is available.
              </p>

              <a
                href="https://github.com/hs-pharma-software/hs-pharma-software/releases/latest/download/Billora_0.1.1_x64-setup.exe"
                className="dl-btn"
                style={{
                  display:"inline-flex",alignItems:"center",gap:12,
                  padding:"18px 44px",
                  background:"linear-gradient(135deg,#1a1a6e 0%,#2d2d9f 100%)",
                  borderRadius:14,color:"white",
                  textDecoration:"none",fontSize:17,fontWeight:800,
                  letterSpacing:"-.02em",
                }}
              >
                <WinIcon size={22}/>
                Download for Windows (.exe)
              </a>

              <p style={{marginTop:14,fontSize:12.5,color:"#94a3b8",letterSpacing:".02em"}}>
                WINDOWS 10 / 11 · 64-BIT · FREE TO DOWNLOAD
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
              <img src="/logo.png" alt="Billora" style={{width:24,height:24,objectFit:"contain"}} />
              <span style={{fontWeight:700,color:"#1a1a6e"}}>Billora</span>
            </div>
            <p>© 2026 Billora · Built for Pakistani Pharmacies</p>
            <p style={{fontSize:12,color:"#cbd5e1",letterSpacing:".01em"}}>
              Developed by <span style={{color:"#1a1a6e",fontWeight:600}}>HS Software and Technology</span>
            </p>
            <Link href="/dashboard" style={{color:"#f97316",textDecoration:"none",fontSize:13,fontWeight:600}}>
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
  {icon:"🧾",color:"#1a1a6e",title:"Point of Sale Invoicing",
   desc:"Keyboard-driven POS with F-key shortcuts, barcode scan, per-line discount, tax, bonus qty & credit/cash invoices."},
  {icon:"📦",color:"#3b82f6",title:"Inventory & Batch Tracking",
   desc:"Batch numbers, expiry dates, FEFO alerts, low-stock warnings, multi-location stock transfers."},
  {icon:"🛒",color:"#8b5cf6",title:"Purchase Management",
   desc:"Order-to-receipt workflow, supplier invoices, ST & WHT tax per line, purchase returns."},
  {icon:"👥",color:"#f97316",title:"Customers & Suppliers",
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
