import { StwrdSessionObject, stwrdFor } from "@stwrd-auth/workers";

// The Durable Object class that wrangler.jsonc binds as STWRD_SESSIONS.
export { StwrdSessionObject };

export default {
  async fetch(request: Request, env: object, ctx: ExecutionContext): Promise<Response> {
    const stwrd = stwrdFor(env);

    // /auth/sign-in, /auth/callback, /auth/sign-out, /auth/session, ...
    const auth = await stwrd.handle(request, ctx);
    if (auth) return auth;

    // Your own routes: the person, or the response that stops the request.
    const guard = await stwrd.requireAuth(request, { ctx });
    if (!guard.ok) return guard.response;
    return Response.json({ user: guard.context.user?.id });
  },
};
