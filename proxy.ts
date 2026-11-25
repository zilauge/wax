import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Clerk routes are public by default, so the desk's pages and APIs are protected
 * here and the handful of deliberate entry points are listed as public: the
 * marketing page, the hosted sign-in/up screens, invitation links (which must
 * work before signing in) and provider webhooks/callbacks that authenticate
 * themselves with signatures or shared secrets.
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  // Old entry points: they redirect to Clerk rather than gating themselves,
  // otherwise the gate would add ?redirect_url=/login and loop.
  "/login",
  "/signup",
  "/invite(.*)",
  "/api/webhooks(.*)",
  "/api/channels/(.*)/callback",
  "/api/sync(.*)",
  // A scheduler has no session. The route itself requires WAX_JOBS_TOKEN and
  // returns 404 while that is unset.
  "/api/jobs/tick",
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
