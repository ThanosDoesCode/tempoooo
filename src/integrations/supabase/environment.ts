export type SupabaseEnvironment = Record<string, string | undefined>;

export type PublicSupabaseConfiguration = {
  url: string | undefined;
  publishableKey: string | undefined;
};

/** Resolve Lovable's canonical Vite names in browser-build and SSR-runtime contexts. */
export function resolvePublicSupabaseConfiguration(
  buildEnvironment: SupabaseEnvironment,
  runtimeEnvironment: SupabaseEnvironment,
): PublicSupabaseConfiguration {
  return {
    url:
      buildEnvironment["VITE_SUPABASE_URL"] ||
      runtimeEnvironment["VITE_SUPABASE_URL"] ||
      runtimeEnvironment["SUPABASE_URL"] ||
      PUBLIC_SUPABASE_URL_FALLBACK,
    publishableKey:
      buildEnvironment["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
      runtimeEnvironment["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
      runtimeEnvironment["SUPABASE_PUBLISHABLE_KEY"] ||
      PUBLIC_SUPABASE_PUBLISHABLE_KEY_FALLBACK,
  };
}

export function missingPublicSupabaseVariables(configuration: PublicSupabaseConfiguration) {
  return [
    ...(!configuration.url ? ["VITE_SUPABASE_URL"] : []),
    ...(!configuration.publishableKey ? ["VITE_SUPABASE_PUBLISHABLE_KEY"] : []),
  ];
}

/**
 * Public (publishable) fallbacks. These values are safe to ship in the browser
 * bundle and guarantee the app initialises even when a build container fails to
 * inject the managed VITE_* variables.
 */
export const PUBLIC_SUPABASE_URL_FALLBACK = "https://skuwrdkjgyjgqhwdopyd.supabase.co";
export const PUBLIC_SUPABASE_PUBLISHABLE_KEY_FALLBACK =
  "sb_publishable_Vg3Kbyr3r9KwtQ8Y6j1brA_CAniXbQI";
