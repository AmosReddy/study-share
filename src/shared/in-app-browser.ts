/**
 * Apps like Instagram and Facebook open links in their own built-in browser, where Google
 * refuses to sign in. We detect that case so we can ask people to open the link in their
 * real browser. Links opened from WhatsApp normally use the default browser, so WhatsApp
 * is deliberately not listed.
 */
const IN_APP_BROWSER_MARKERS = [
  /\bInstagram\b/i,
  /\bFBAN\b/, // Facebook for iOS
  /\bFBAV\b/, // Facebook for Android and iOS
  /\bFB_IAB\b/, // Facebook / Messenger in-app browser
  /\bLinkedInApp\b/i,
  /\bSnapchat\b/i,
  /; wv\)/, // Android WebView
];

export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP_BROWSER_MARKERS.some((marker) => marker.test(userAgent));
}
