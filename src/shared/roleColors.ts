import type { Role } from "../contracts/index.ts";

/** SLGO team colours: the SCP faction red of the HUD and the NTF blue. */
export const ROLE_COLORS: Readonly<Record<Role, string>> = {
  scp: "#d94652",
  ntf: "rgb(150, 200, 250)",
};
