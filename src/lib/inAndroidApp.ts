/** Whether the web app is running inside the MAVIN Business Android app (TWA)
 * or an installed app window on Android. Used to keep purchases of MAVIN.pk's
 * own subscription out of the Android app until Google Play's payments policy
 * has been checked for it. Errs on the side of "in the app". */
export function inAndroidApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (document.referrer.startsWith("android-app://")) sessionStorage.setItem("mavin-android-app", "1");
    if (sessionStorage.getItem("mavin-android-app") === "1") return true;
  } catch {
    /* storage blocked: fall through */
  }
  return /Android/i.test(navigator.userAgent) && window.matchMedia?.("(display-mode: standalone)").matches === true;
}
