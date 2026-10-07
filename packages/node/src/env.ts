/**
 * `configFromEnv` for Node: the core's reader with `process.env` as the
 * default environment. The core has no default of its own (it also runs where
 * there is no `process.env`); this wrapper keeps the public signature of
 * `@stwrd-auth/node` stable.
 */

import { ENV_PREFIX, configFromEnv as readConfigFromEnv, type StwrdConfigOptions } from "@stwrd-auth/core/config";

export function configFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  envPrefix: string = ENV_PREFIX,
): Partial<StwrdConfigOptions> {
  return readConfigFromEnv(env, envPrefix);
}
