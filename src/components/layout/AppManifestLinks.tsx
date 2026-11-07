/** The installable-app details of the MAVIN.pk app (sign-in and app pages
 * only). Not on the public site or a business's own website, so a store
 * visitor never installs "MAVIN.pk" from a tenant's domain. React puts these in <head>. */
export function AppManifestLinks() {
  return (
    <>
      <link rel="manifest" href="/app.webmanifest" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content="MAVIN.pk" />
    </>
  );
}
