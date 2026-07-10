export type WeaponId = "sword" | "dagger" | "bow" | "staff";

export interface ClientWeaponDef {
  name: string;
  /** True while using a colored-rectangle stand-in instead of real art. */
  placeholder: boolean;
}

export const CLIENT_WEAPON_REGISTRY: Record<WeaponId, ClientWeaponDef> = {
  sword:  { name: "Sword",  placeholder: false },
  dagger: { name: "Dagger", placeholder: true  },
  bow:    { name: "Bow",    placeholder: true  },
  staff:  { name: "Staff",  placeholder: true  },
};
