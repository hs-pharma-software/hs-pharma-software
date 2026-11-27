"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Building2, Check, CircleAlert, Clock, Landmark, MapPin, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { FormError } from "@/components/ui/FormError";
import { notify } from "@/lib/notify";
import { DUR, EASE_OUT } from "@/lib/motion";
import {
  errText, portalCategories, saveProfileStep, submitRegistration, type EpCategory, type VendorAccount,
} from "@/lib/vendorPortalClient";
import { BUSINESS_KIND_LABEL, stepProblems, type BusinessKind, type ProfileStep, type VendorProfile } from "@/lib/vendorProfile";

const card = "rounded-2xl bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04] sm:p-6";
const PROVINCES = ["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Islamabad Capital Territory", "Gilgit-Baltistan", "Azad Jammu & Kashmir"];
const BANKS = ["Allied Bank", "Askari Bank", "Bank Al Habib", "Bank Alfalah", "Bank of Khyber", "Bank of Punjab", "BankIslami", "Dubai Islamic Bank", "Faysal Bank",
  "First Women Bank", "Habib Bank Limited (HBL)", "Habib Metropolitan Bank", "JS Bank", "MCB Bank", "MCB Islamic Bank", "Meezan Bank", "National Bank of Pakistan",
  "Samba Bank", "Silkbank", "Sindh Bank", "Soneri Bank", "Standard Chartered", "Summit Bank", "United Bank Limited (UBL)", "Al Baraka Bank", "Zarai Taraqiati Bank"];

const STEPS: { key: ProfileStep | "review"; title: string; short: string; icon: typeof Building2 }[] = [
  { key: "company", title: "Company, owner and business", short: "Company", icon: Building2 },
  { key: "address", title: "Address", short: "Address", icon: MapPin },
  { key: "bank", title: "Bank details", short: "Bank", icon: Landmark },
  { key: "review", title: "Check and submit", short: "Submit", icon: ShieldCheck },
];

type Section = "company" | "owner" | "business" | "address" | "bank";
type Setter = <S extends Section>(section: S, field: keyof VendorProfile[S], value: VendorProfile[S][keyof VendorProfile[S]]) => void;

/** The four registration steps: saved step by step (the vendor can stop and
 * continue later), then submitted to MAVIN.pk for approval. */
export function RegistrationWizard({ account, onChanged }: { account: VendorAccount; onChanged: () => void }) {
  const [profile, setProfile] = useState<VendorProfile>(account.profile);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [tried, setTried] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [categories, setCategories] = useState<EpCategory[]>([]);
  useEffect(() => { void portalCategories().then(setCategories).catch(() => setCategories([])); }, []);

  const current = STEPS[step].key;
  const problems = useMemo(() => (current === "review" ? {} : stepProblems(profile, current)), [profile, current]);
  const shownProblems = tried[current] ? problems : {};
  const set: Setter = (section, field, value) => setProfile((p) => ({ ...p, [section]: { ...p[section], [field]: value } }));

  const go = (to: number) => { setDir(to > step ? 1 : -1); setStep(to); setError(null); window.scrollTo?.({ top: 0, behavior: "smooth" }); };

  async function next() {
    if (current === "review") return;
    setTried((t) => ({ ...t, [current]: true }));
    const first = Object.keys(problems)[0];
    if (first) { document.getElementById(`vr-${first.replace(".", "-")}`)?.focus(); return; }
    setBusy(true);
    setError(null);
    try { await saveProfileStep(current, profile); go(step + 1); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  async function submit() {
    if (!confirmed) { setError("Tick the statement that the details are correct."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await submitRegistration();
      notify(r.status === "pending" ? "Submitted. MAVIN.pk will check your details and approve your account." : "Your details are saved.", "success");
      onChanged();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }

  const f = (section: Section, field: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> & { required?: boolean; hint?: string } = {}) => {
    const key = `${section}.${field}`;
    const { required, hint, ...rest } = props;
    const value = String((profile[section] as Record<string, unknown>)[field] ?? "");
    return (
      <Field label={label} required={required} hint={hint} error={shownProblems[key]}>
        <Input id={`vr-${section}-${field}`} value={value} aria-invalid={Boolean(shownProblems[key]) || undefined}
          onChange={(e) => set(section, field as never, e.target.value as never)} {...rest} />
      </Field>
    );
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight text-neutral-900">{account.status === "approved" ? "Complete your vendor details" : "Vendor registration"}</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {account.status === "approved"
            ? "Your account is active. Fill in the details MAVIN.pk keeps for every vendor; nothing else changes."
            : "Four short steps. Each step is saved when you continue, so you can stop and come back later. MAVIN.pk checks the details before hospitals can add you."}
        </p>
      </div>

      {(account.status === "changes" || account.status === "rejected") && account.reviewNote && (
        <div role="status" className="rise-in mb-4 flex gap-2.5 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <CircleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div><b>{account.status === "changes" ? "MAVIN.pk asked for changes:" : "Your registration was not approved:"}</b> {account.reviewNote}
            <span className="block text-xs text-amber-800">Correct the details and submit again.</span></div>
        </div>
      )}

      {/* Step indicator */}
      <ol className="mb-4 grid grid-cols-4 gap-1.5" aria-label="Registration steps">
        {STEPS.map((s, i) => {
          const done = i < step;
          const here = i === step;
          return (
            <li key={s.key}>
              <button type="button" disabled={i > step || busy} onClick={() => go(i)} aria-current={here ? "step" : undefined}
                className="group flex w-full flex-col items-start gap-1.5 text-left disabled:cursor-default">
                <span className="relative h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                  <motion.span className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]" initial={false}
                    animate={{ width: done ? "100%" : here ? "50%" : "0%" }} transition={{ duration: DUR.slow * 1.6, ease: EASE_OUT }} />
                </span>
                <span className={`flex items-center gap-1.5 text-xs font-medium ${here ? "text-neutral-900" : done ? "text-[var(--accent)]" : "text-neutral-400"}`}>
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${done ? "bg-[var(--accent)] text-white" : here ? "bg-neutral-900 text-white" : "bg-neutral-200 text-neutral-500"}`}>
                    {done ? <Check size={11} strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="truncate max-sm:hidden">{s.title}</span><span className="truncate sm:hidden">{s.short}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className={`${card} overflow-hidden`}>
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div key={current} custom={dir}
            initial={{ opacity: 0, x: dir * 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -16 }}
            transition={{ duration: DUR.slow, ease: EASE_OUT }}>
            {current === "company" && (
              <div className="flex flex-col gap-5">
                <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <legend className="mb-2 text-sm font-semibold text-neutral-900">Company details</legend>
                  <div className="sm:col-span-2">{f("company", "name", "Company name", { required: true, autoComplete: "organization" })}</div>
                  {f("company", "regNo", "Registration no (SECP / firm)", { hint: "If registered" })}
                  {f("company", "ntn", "NTN", { hint: "National Tax Number, if any", inputMode: "numeric" })}
                  {f("company", "phone", "Company phone", { required: true, type: "tel", inputMode: "tel" })}
                  {f("company", "email", "Company email", { required: true, type: "email", inputMode: "email" })}
                  <div className="sm:col-span-2">{f("company", "website", "Website", { placeholder: "www.example.com", inputMode: "url" })}</div>
                </fieldset>
                <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <legend className="mb-2 text-sm font-semibold text-neutral-900">Owner details</legend>
                  {f("owner", "name", "Owner name", { required: true, autoComplete: "name" })}
                  {f("owner", "designation", "Designation", { placeholder: "Proprietor, CEO, Partner…" })}
                  {f("owner", "cnic", "CNIC", { placeholder: "12345-1234567-1", inputMode: "numeric" })}
                  {f("owner", "mobile", "Mobile", { required: true, type: "tel", inputMode: "tel" })}
                  <div className="sm:col-span-2">{f("owner", "email", "Owner email", { type: "email", inputMode: "email" })}</div>
                </fieldset>
                <BusinessPicker profile={profile} set={set} categories={categories} problems={shownProblems} />
              </div>
            )}

            {current === "address" && (
              <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <legend className="mb-2 text-sm font-semibold text-neutral-900">Business address</legend>
                <div className="sm:col-span-2">{f("address", "line1", "Street address", { required: true, autoComplete: "street-address", placeholder: "Shop / office no, building, street" })}</div>
                {f("address", "area", "Area / town")}
                {f("address", "city", "City", { required: true, autoComplete: "address-level2" })}
                <Field label="Province" required error={shownProblems["address.province"]}>
                  <Select id="vr-address-province" value={profile.address.province} aria-invalid={Boolean(shownProblems["address.province"]) || undefined}
                    onChange={(e) => set("address", "province", e.target.value)}>
                    <option value="">Choose…</option>
                    {PROVINCES.map((p) => <option key={p}>{p}</option>)}
                  </Select>
                </Field>
                {f("address", "postalCode", "Postal code", { inputMode: "numeric", autoComplete: "postal-code" })}
                <div className="sm:col-span-2">{f("address", "country", "Country", { required: true, autoComplete: "country-name" })}</div>
              </fieldset>
            )}

            {current === "bank" && (
              <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <legend className="mb-1 text-sm font-semibold text-neutral-900">Bank details</legend>
                <p className="mb-1 text-xs text-neutral-500 sm:col-span-2">Hospitals pay you into this account. Only you and MAVIN.pk see these details here.</p>
                <div className="sm:col-span-2">{f("bank", "accountTitle", "Account title", { required: true, hint: "Exactly as the bank shows it" })}</div>
                {f("bank", "bank", "Bank", { required: true, list: "vr-banks" })}
                <datalist id="vr-banks">{BANKS.map((b) => <option key={b} value={b} />)}</datalist>
                {f("bank", "accountNo", "Account no", { required: true, inputMode: "numeric" })}
                <div className="sm:col-span-2">{f("bank", "iban", "IBAN", { required: true, placeholder: "PK36SCBL0000001123456702", autoCapitalize: "characters", spellCheck: false })}</div>
                {f("bank", "branch", "Branch", { required: true, placeholder: "Branch name" })}
                {f("bank", "branchCode", "Branch code", { inputMode: "numeric" })}
                {f("bank", "city", "Branch city", { required: true })}
              </fieldset>
            )}

            {current === "review" && (
              <div className="flex flex-col gap-4">
                <ProfileSummary profile={profile} onEdit={(s) => go(s)} />
                <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-neutral-50 p-3 text-sm text-neutral-800 ring-1 ring-neutral-200 has-[:checked]:bg-emerald-50 has-[:checked]:ring-emerald-300">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" />
                  <span>I confirm that all the information I have provided is <b>correct and complete</b>, and that I am authorised to register this business. I understand that false information can lead to rejection or blacklisting.</span>
                </label>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <FormError message={error} className="mt-4" />
        <div className="form-actions mt-5 flex items-center justify-between gap-2 border-t border-neutral-200 pt-3">
          <Button disabled={step === 0 || busy} onClick={() => go(step - 1)}>Back</Button>
          {current === "review"
            ? <Button variant="primary" loading={busy} disabled={busy || !confirmed} onClick={() => void submit()}>{account.status === "approved" ? "Save details" : "Submit for approval"}</Button>
            : <Button variant="primary" loading={busy} disabled={busy} onClick={() => void next()}>Save and continue</Button>}
        </div>
      </div>
    </div>
  );
}

function BusinessPicker({ profile, set, categories, problems }: { profile: VendorProfile; set: Setter; categories: EpCategory[]; problems: Record<string, string> }) {
  const kind = profile.business.kind;
  const list = categories.filter((c) => kind === "both" || c.kind === kind);
  const chosen = new Set(profile.business.categories);
  const toggle = (name: string) => {
    const next = new Set(chosen);
    if (next.has(name)) next.delete(name); else next.add(name);
    set("business", "categories", [...next]);
  };
  const setKind = (k: BusinessKind) => {
    // Kinds of work that do not belong to the new choice are dropped.
    const allowed = new Set(categories.filter((c) => k === "both" || c.kind === k).map((c) => c.name));
    set("business", "kind", k);
    set("business", "categories", profile.business.categories.filter((c) => allowed.has(c)));
  };
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-sm font-semibold text-neutral-900">Business type</legend>
      <div role="radiogroup" aria-label="Business type" id="vr-business-kind" tabIndex={-1} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(["supplier", "services", "both"] as BusinessKind[]).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={`rounded-xl px-3 py-3 text-left text-sm ring-1 transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.98] ${kind === k ? "bg-[color-mix(in_srgb,var(--accent)_8%,white)] font-semibold text-neutral-900 ring-2 ring-[var(--accent)]" : "bg-white text-neutral-700 ring-neutral-200 hover:ring-neutral-300"}`}>
            {BUSINESS_KIND_LABEL[k]}
            <span className="block text-xs font-normal text-neutral-500">{k === "supplier" ? "You sell goods" : k === "services" ? "You do work or services" : "Goods and services"}</span>
          </button>
        ))}
      </div>
      {problems["business.kind"] && <p className="field-msg text-xs text-rose-600">{problems["business.kind"]}</p>}
      {kind && (
        <div className="fade-in">
          <p className="mb-1.5 text-xs font-medium text-neutral-600">Which kind of work do you do? <span className="text-neutral-400">(choose all that apply)</span></p>
          <div id="vr-business-categories" tabIndex={-1} className="flex flex-wrap gap-1.5">
            {list.map((c) => (
              <button key={c.id} type="button" aria-pressed={chosen.has(c.name)} onClick={() => toggle(c.name)}
                className={`flex min-h-9 items-center gap-1 rounded-full px-3 text-xs font-medium ring-1 transition-colors ${chosen.has(c.name) ? "bg-[var(--accent)] text-white ring-[var(--accent)]" : "bg-white text-neutral-700 ring-neutral-200 hover:bg-neutral-50"}`}>
                {chosen.has(c.name) && <Check size={12} strokeWidth={3} aria-hidden="true" />}{c.name}
              </button>
            ))}
          </div>
          {problems["business.categories"] && <p className="field-msg mt-1.5 text-xs text-rose-600">{problems["business.categories"]}</p>}
        </div>
      )}
      <Field label="About your business" hint="What you supply or do, brands you deal in (optional)">
        <Textarea rows={3} value={profile.business.description} onChange={(e) => set("business", "description", e.target.value)} />
      </Field>
    </fieldset>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex gap-3 py-1 text-sm"><dt className="w-36 shrink-0 text-neutral-500">{label}</dt><dd className="min-w-0 break-words font-medium text-neutral-900">{value || "—"}</dd></div>
);

/** The registration details, section by section (the review step, the waiting screen and the Super Admin). */
export function ProfileSummary({ profile: p, onEdit }: { profile: VendorProfile; onEdit?: (step: number) => void }) {
  const box = (title: string, step: number, children: React.ReactNode) => (
    <section className="rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200/70">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
        {onEdit && <button type="button" onClick={() => onEdit(step)} className="rounded-lg px-2 py-1 text-xs font-medium text-[var(--accent)] hover:bg-white">Edit</button>}
      </div>
      <dl>{children}</dl>
    </section>
  );
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {box("Company", 0, <>
        <Row label="Company" value={p.company.name} /><Row label="Registration no" value={p.company.regNo} /><Row label="NTN" value={p.company.ntn} />
        <Row label="Phone" value={p.company.phone} /><Row label="Email" value={p.company.email} /><Row label="Website" value={p.company.website} />
      </>)}
      {box("Owner", 0, <>
        <Row label="Name" value={p.owner.name} /><Row label="Designation" value={p.owner.designation} /><Row label="CNIC" value={p.owner.cnic} />
        <Row label="Mobile" value={p.owner.mobile} /><Row label="Email" value={p.owner.email} />
      </>)}
      {box("Business", 0, <>
        <Row label="Type" value={p.business.kind ? BUSINESS_KIND_LABEL[p.business.kind] : ""} />
        <Row label="Kinds of work" value={p.business.categories.join(", ")} /><Row label="About" value={p.business.description} />
      </>)}
      {box("Address", 1, <>
        <Row label="Street" value={p.address.line1} /><Row label="Area" value={p.address.area} /><Row label="City" value={p.address.city} />
        <Row label="Province" value={p.address.province} /><Row label="Postal code" value={p.address.postalCode} /><Row label="Country" value={p.address.country} />
      </>)}
      <div className="md:col-span-2">{box("Bank", 2, <>
        <Row label="Account title" value={p.bank.accountTitle} /><Row label="Bank" value={p.bank.bank} /><Row label="IBAN" value={p.bank.iban} />
        <Row label="Account no" value={p.bank.accountNo} /><Row label="Branch" value={[p.bank.branch, p.bank.branchCode].filter(Boolean).join(" · ")} /><Row label="City" value={p.bank.city} />
      </>)}</div>
    </div>
  );
}

/** What a vendor whose account is not (yet) usable sees instead of the portal. */
export function AccountStatusScreen({ account }: { account: VendorAccount }) {
  const pending = account.status === "pending";
  const Icon = pending ? Clock : ShieldAlert;
  return (
    <div className="mx-auto max-w-3xl">
      <div className={`${card} rise-in mb-4 flex gap-3`}>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${pending ? "bg-sky-50 text-sky-700" : "bg-rose-50 text-rose-700"}`}><Icon size={22} aria-hidden="true" /></span>
        <div>
          <h1 className="text-lg font-bold text-neutral-900">{account.statusLabel}</h1>
          <p className="mt-0.5 text-sm text-neutral-600">
            {pending
              ? `You submitted your registration${account.submittedAt ? ` on ${account.submittedAt.slice(0, 10)}` : ""}. MAVIN.pk is checking your details; once approved, hospitals using eProcurement can add you and you will see their quote requests here.`
              : account.status === "suspended" ? "Your vendor account is suspended: quote requests, orders and payments are closed for now. Contact MAVIN.pk (0316-0585858)."
              : "Your vendor account is blacklisted and cannot be used. Contact MAVIN.pk (0316-0585858)."}
          </p>
          {account.reviewNote && !pending && <p className="mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-700 ring-1 ring-neutral-200"><b>Reason:</b> {account.reviewNote}</p>}
        </div>
      </div>
      {pending && <ProfileSummary profile={account.profile} />}
    </div>
  );
}
