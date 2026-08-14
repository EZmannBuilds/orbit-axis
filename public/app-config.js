// Orbit Axis :: runtime application configuration.
//
// GENERATED for native builds by `npm run app:config`. The value committed here
// is the SAME-ORIGIN DEFAULT and is deliberately inert:
//
//   apiBaseUrl: ""  →  the application calls its own origin, exactly as the
//                      web version always has.
//
// That default is correct for every browser, for local development, and for
// the Vercel deployment. Only the iOS container needs something else, because
// it is served from capacitor://localhost and has no same-origin API.
//
// WHY THIS FILE IS COMMITTED RATHER THAN GITIGNORED
//
// public/index.html references it, and scripts/build.js fails the build when
// the document references a file that does not exist — correctly, because a
// 404 on a script tag silently disables part of the app. A gitignored config
// would therefore break the production web build on a clean checkout.
//
// WHAT MUST NOT BE COMMITTED
//
// A real origin. Run `npm run app:config` before a native build to write one
// locally, and do not commit the result — `npm run app:check` fails if a
// non-empty value is staged. This file holds no secret and never should: it is
// served to every browser. API keys, tokens, and Supabase service-role
// credentials do not belong here or anywhere else in public/.

globalThis.ORBIT_APP_CONFIG = {
  apiBaseUrl: "",
};
