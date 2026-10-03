import type { SteamIdentity, SteamIdentityProof, VerificationState } from "../contracts";
import type { IdentityProofProvider, SteamClientIdentity } from "./index";

export class LocalSteamIdentity implements SteamClientIdentity {
  async getCurrentUser(): Promise<SteamIdentity | null> {
    if ("__TAURI_INTERNALS__" in window) {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ steam_id: string } | null>("get_current_steam_identity");
      if (result && /^[0-9]{17}$/.test(result.steam_id)) return { steamId: result.steam_id };
      return null;
    }
    const explicit = (import.meta.env.VITE_STEAM_ID as string | undefined)?.trim();
    if (explicit && /^[0-9]{17}$/.test(explicit)) return { steamId: explicit, personaName: "Nova" };
    return null;
  }
}

export class LocalSteamProofProvider implements IdentityProofProvider {
  async getProof(identity: SteamIdentity): Promise<SteamIdentityProof> {
    return { kind: "local-steamid", steamId: identity.steamId };
  }
  isVerified(): boolean {
    return false;
  }
}

export class DevelopmentMockVerifiedProofProvider implements IdentityProofProvider {
  async getProof(identity: SteamIdentity): Promise<SteamIdentityProof> {
    return {
      kind: "device-signature",
      deviceId: `browser-preview-${identity.steamId}`,
      signature: "development-only-mock-signature",
    };
  }
  isVerified(proof: SteamIdentityProof | null): boolean {
    return proof?.kind === "device-signature";
  }
}

export function createIdentityProofProvider(enableDevelopmentMock: boolean): IdentityProofProvider {
  return enableDevelopmentMock
    ? new DevelopmentMockVerifiedProofProvider()
    : new LocalSteamProofProvider();
}

export function getVerificationState(identity: SteamIdentity | null, proof: SteamIdentityProof | null, provider: IdentityProofProvider): VerificationState | null {
  if (!identity) return null;
  if (proof?.kind === "local-steamid") return proof.steamId === identity.steamId ? { kind: "claimed", identity, mode: proof.kind } : { kind: "unverified", identity };
  if (proof && provider.isVerified(proof)) return { kind: "verified", identity, mode: proof.kind };
  return { kind: "unverified", identity };
}
