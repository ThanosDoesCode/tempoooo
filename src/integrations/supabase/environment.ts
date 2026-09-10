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
      runtimeEnvironment["SUPABASE_URL"],
    publishableKey:
      buildEnvironment["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
      runtimeEnvironment["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
      runtimeEnvironment["SUPABASE_PUBLISHABLE_KEY"],
  };
}

export function missingPublicSupabaseVariables(configuration: PublicSupabaseConfiguration) {
  return [
    ...(!configuration.url ? ["VITE_SUPABASE_URL"] : []),
    ...(!configuration.publishableKey ? ["VITE_SUPABASE_PUBLISHABLE_KEY"] : []),
  ];
}
