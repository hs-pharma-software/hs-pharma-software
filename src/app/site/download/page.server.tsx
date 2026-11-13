import type { Metadata } from "next";
import { withSeoMeta } from "@/config/seoMeta";
import { PageIntro, Section } from "@/components/site/chrome";
import { ANDROID_RELEASE as R, androidReleaseDateLabel, androidSizeLabel } from "@/config/androidRelease";
import { WINDOWS_RELEASE as W, windowsReleaseDateLabel, windowsSizeLabel } from "@/config/windowsRelease";

const WINDOWS_INSTALL = [
  ["Download", `Click "Download for Windows". The file is ${windowsSizeLabel()}.`],
  ["Run the installer", `Open ${W.fileName} from your Downloads folder.`],
  ["If Windows warns you", "Windows may show \"Windows protected your PC\" for new software. Click More info, check the file name, then click Run anyway."],
  ["Sign in", "Sign in once with your MAVIN.pk login while online. After that the app also works offline. To update, install the new version over the old one: your data is kept."],
] as const;

export const metadata: Metadata = withSeoMeta("/download", { alternates: { canonical: "/download" } });

const INSTALL = [
  ["Download", `Tap "Download for Android" on your phone. The file is ${androidSizeLabel()}.`],
  ["Open the file", "When the download finishes, tap the notification, or open it from Files > Downloads."],
  ["Allow this source if asked", "If Android says installing from this source is not allowed, tap Settings and turn on \"Allow from this source\" for the browser you downloaded with (for example Chrome), then go back."],
  ["Install", "Check that the app is MAVIN Business, then tap Install. Open it and sign in with your MAVIN.pk login."],
] as const;

/** www.mavin.pk/download: the Android app (APK) with install and update help. */
export default function DownloadPage() {
  return (
    <>
      <PageIntro eyebrow="Download" title="MAVIN Business for Android">
        The MAVIN.pk app for Android phones and tablets. It opens your MAVIN.pk account full screen and uses MAVIN.pk&apos;s online
        services, so it needs an internet connection.
      </PageIntro>

      <Section>
        <div className="grid max-w-4xl gap-6 rounded-2xl border border-slate-200 bg-white p-6 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <p className="text-lg font-semibold text-[#0b2a6b]">{R.appName}</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-slate-600">
              <dt className="text-slate-400">Version</dt><dd>{R.versionName}</dd>
              <dt className="text-slate-400">Released</dt><dd>{androidReleaseDateLabel()}</dd>
              <dt className="text-slate-400">Size</dt><dd>{androidSizeLabel()}</dd>
              <dt className="text-slate-400">Needs</dt><dd>{R.minAndroid} and an internet connection</dd>
            </dl>
          </div>
          <a
            href={R.path}
            download
            type="application/vnd.android.package-archive"
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#0b2a6b] px-6 py-3 text-base font-semibold text-white hover:bg-[#1565c0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1565c0]"
          >
            Download for Android
          </a>
        </div>
      </Section>

      <Section title="How to install">
        <ol className="grid max-w-4xl gap-3 sm:grid-cols-2">
          {INSTALL.map(([t, d], i) => (
            <li key={t} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <p className="font-semibold text-[#0b2a6b]">{i + 1}. {t}</p>
              <p className="mt-1 text-slate-600">{d}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Already have the app?">
        <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-slate-600">
          <p>Install the new version over the old one, the same way as above, without uninstalling first. Android keeps you signed in and keeps the app&apos;s settings.</p>
          <p>
            If Android says the app is <b>not installed</b> or <b>conflicts with an existing package</b>, the app on your phone was signed with a different key
            (for example a test copy). Android cannot update it. Only in that case, uninstall the old app first, then install this one. Uninstalling can clear what the
            app kept on the phone, such as being signed in, so you may need to sign in again. Your business records are kept on MAVIN.pk&apos;s servers and are not affected.
          </p>
        </div>
      </Section>

      <Section title={`What's new in ${R.versionName}`}>
        <ul className="max-w-3xl list-disc space-y-1.5 pl-5 text-sm text-slate-600">
          {R.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </Section>

      <Section title="Check the file (optional)">
        <div className="max-w-3xl space-y-2 text-sm text-slate-600">
          <p>Package <code className="rounded bg-slate-100 px-1">{R.packageId}</code>, version {R.versionName} (code {R.versionCode}), {R.sizeBytes.toLocaleString("en-US")} bytes.</p>
          <p>SHA-256 of the file:</p>
          <p className="break-all rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700">{R.sha256}</p>
        </div>
      </Section>

      <div id="windows" className="scroll-mt-20 border-t border-slate-200">
        <Section title={`${W.appName}`}>
          <div className="grid max-w-4xl gap-6 rounded-2xl border border-slate-200 bg-white p-6 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="text-sm text-slate-600">
                The MAVIN.pk desktop app for Windows. Billing keeps working when the internet is down, and everything syncs to your MAVIN.pk account when it returns.
              </p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-slate-600">
                <dt className="text-slate-400">Version</dt><dd>{W.versionName}</dd>
                <dt className="text-slate-400">Released</dt><dd>{windowsReleaseDateLabel()}</dd>
                <dt className="text-slate-400">Size</dt><dd>{windowsSizeLabel()}</dd>
                <dt className="text-slate-400">Needs</dt><dd>{W.needs}; internet for the first sign-in on each computer</dd>
              </dl>
            </div>
            <a
              href={W.url}
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[#0b2a6b] px-6 py-3 text-base font-semibold text-white hover:bg-[#1565c0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1565c0]"
            >
              Download for Windows
            </a>
          </div>
        </Section>

        <Section title="Install on Windows">
          <ol className="grid max-w-4xl gap-3 sm:grid-cols-2">
            {WINDOWS_INSTALL.map(([t, d], i) => (
              <li key={t} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                <p className="font-semibold text-[#0b2a6b]">{i + 1}. {t}</p>
                <p className="mt-1 text-slate-600">{d}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section title={`What's new in ${W.versionName}`}>
          <ul className="max-w-3xl list-disc space-y-1.5 pl-5 text-sm text-slate-600">
            {W.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
          <div className="mt-4 max-w-3xl space-y-2 text-sm text-slate-600">
            <p>{W.fileName}, {W.sizeBytes.toLocaleString("en-US")} bytes. SHA-256 of the file:</p>
            <p className="break-all rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700">{W.sha256}</p>
          </div>
        </Section>
      </div>
    </>
  );
}
