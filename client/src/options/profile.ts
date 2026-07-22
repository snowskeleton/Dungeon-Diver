import { CHARACTER_REGISTRY, CharacterClass, CharacterType, WeaponId, WEAPON_REGISTRY, MAX_PLAYER_NAME_LEN } from "shared";
import { Loadout } from "../launch";

/**
 * Who this browser is, between sessions: display name and last-used loadout.
 *
 * This is what removed the two mandatory picker modals that used to stand
 * between "Start" and the game. A returning player joins a lobby already
 * looking like themselves and changes their mind IN the lobby, where the choice
 * has context (who else is here, what they picked) instead of in a vacuum.
 *
 * Separate from GameOptions because it isn't a setting — nothing here appears in
 * the Options panel, and it is sent to the server rather than kept local.
 */

export interface Profile {
  name: string;
  characterClass: CharacterClass;
  characterType: CharacterType;
  weaponId: WeaponId;
}

const STORAGE_KEY = "game2.profile";

export const DEFAULT_PROFILE: Profile = {
  name: "Player",
  characterClass: "knight",
  characterType: "guy",
  weaponId: CHARACTER_REGISTRY.knight.defaultWeaponId,
};

let cached: Profile | null = null;

/** Anything read back from storage is validated against the registries: a skin
 *  or weapon we since renamed would otherwise be sent to the server as a real
 *  choice and quietly fall back to a knight with a broadsword. */
function sanitize(raw: Partial<Profile>): Profile {
  const characterClass = raw.characterClass && CHARACTER_REGISTRY[raw.characterClass]
    ? raw.characterClass
    : DEFAULT_PROFILE.characterClass;
  const weaponId = raw.weaponId && WEAPON_REGISTRY[raw.weaponId]
    ? raw.weaponId
    : CHARACTER_REGISTRY[characterClass].defaultWeaponId;
  const name = (raw.name ?? "").trim().slice(0, MAX_PLAYER_NAME_LEN);
  return {
    name: name.length > 0 ? name : DEFAULT_PROFILE.name,
    characterClass,
    characterType: raw.characterType ?? DEFAULT_PROFILE.characterType,
    weaponId,
  };
}

export function loadProfile(): Profile {
  if (cached) return cached;
  let loaded = { ...DEFAULT_PROFILE };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) loaded = sanitize({ ...DEFAULT_PROFILE, ...JSON.parse(raw) });
  } catch {
    // Corrupt or unavailable storage — fall back to defaults.
  }
  cached = loaded;
  return loaded;
}

export function saveProfile(profile: Profile) {
  cached = sanitize(profile);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // Non-fatal: the profile just won't survive a reload.
  }
}

/** The loadout half of the profile, in the shape the join flow passes around. */
export function profileLoadout(profile: Profile = loadProfile()): Loadout {
  return {
    characterClass: profile.characterClass,
    characterType: profile.characterType,
    weaponId: profile.weaponId,
  };
}
