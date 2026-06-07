import {
  AircraftType,
  InfantryType,
  StructType,
  UnitType,
} from './definitions';

export type WeaponBeamMode =
  | 'tesla'
  | 'flame'
  | 'projectile'
  | 'grenade'
  | 'rocket'
  | 'tracer'
  | 'shell_light'
  | 'shell_medium'
  | 'shell_heavy'
  | 'burst'
  | 'strafe';

export interface WeaponVisualDef {
  id: string;
  beamMode: WeaponBeamMode;
  duration: number;
  intensity: number;
  lineWidth: number;
  headSize: number;
  impactTint?: number;
}

const WEAPON_VISUALS: Record<string, WeaponVisualDef> = {
  [StructType.Pillbox]: {
    id: StructType.Pillbox,
    beamMode: 'tracer',
    duration: 110,
    intensity: 0.68,
    lineWidth: 1,
    headSize: 1.6,
    impactTint: 0xfff0c8,
  },
  [StructType.Turret]: {
    id: StructType.Turret,
    beamMode: 'shell_medium',
    duration: 205,
    intensity: 1.22,
    lineWidth: 2,
    headSize: 2.8,
  },
  [StructType.FlameTurret]: {
    id: StructType.FlameTurret,
    beamMode: 'flame',
    duration: 210,
    intensity: 1.55,
    lineWidth: 3,
    headSize: 3.2,
    impactTint: 0xffb34d,
  },
  [StructType.Sam]: {
    id: StructType.Sam,
    beamMode: 'rocket',
    duration: 290,
    intensity: 1.48,
    lineWidth: 2,
    headSize: 3.4,
    impactTint: 0xff8a4d,
  },
  [StructType.AaGun]: {
    id: StructType.AaGun,
    beamMode: 'burst',
    duration: 175,
    intensity: 1.18,
    lineWidth: 1.5,
    headSize: 2.2,
    impactTint: 0xfff2a6,
  },
  [StructType.Tesla]: {
    id: StructType.Tesla,
    beamMode: 'tesla',
    duration: 260,
    intensity: 2.1,
    lineWidth: 2,
    headSize: 3,
    impactTint: 0x8fd6ff,
  },
  [UnitType.LightTank]: {
    id: UnitType.LightTank,
    beamMode: 'shell_light',
    duration: 165,
    intensity: 1.02,
    lineWidth: 1.5,
    headSize: 2.2,
  },
  [UnitType.MediumTank]: {
    id: UnitType.MediumTank,
    beamMode: 'shell_medium',
    duration: 195,
    intensity: 1.18,
    lineWidth: 2,
    headSize: 2.6,
  },
  [UnitType.HeavyTank]: {
    id: UnitType.HeavyTank,
    beamMode: 'shell_heavy',
    duration: 235,
    intensity: 1.52,
    lineWidth: 3,
    headSize: 3.4,
  },
  [UnitType.Artillery]: {
    id: UnitType.Artillery,
    beamMode: 'projectile',
    duration: 520,
    intensity: 1.9,
    lineWidth: 2,
    headSize: 5,
    impactTint: 0xffc46d,
  },
  [UnitType.Apc]: {
    id: UnitType.Apc,
    beamMode: 'tracer',
    duration: 145,
    intensity: 0.82,
    lineWidth: 1,
    headSize: 1.8,
  },
  [InfantryType.Rifle]: {
    id: InfantryType.Rifle,
    beamMode: 'tracer',
    duration: 95,
    intensity: 0.62,
    lineWidth: 1,
    headSize: 1.4,
    impactTint: 0xfff0d8,
  },
  [InfantryType.Grenadier]: {
    id: InfantryType.Grenadier,
    beamMode: 'grenade',
    duration: 360,
    intensity: 1.35,
    lineWidth: 2,
    headSize: 3.6,
    impactTint: 0xffb86b,
  },
  [InfantryType.Rocket]: {
    id: InfantryType.Rocket,
    beamMode: 'rocket',
    duration: 330,
    intensity: 1.38,
    lineWidth: 2.5,
    headSize: 3.8,
    impactTint: 0xff9a4d,
  },
  [InfantryType.Flamethrower]: {
    id: InfantryType.Flamethrower,
    beamMode: 'flame',
    duration: 180,
    intensity: 1.48,
    lineWidth: 3,
    headSize: 2.8,
    impactTint: 0xffb34d,
  },
  [AircraftType.Hind]: {
    id: AircraftType.Hind,
    beamMode: 'rocket',
    duration: 250,
    intensity: 1.42,
    lineWidth: 2,
    headSize: 3.2,
    impactTint: 0xff7a3d,
  },
  [AircraftType.Longbow]: {
    id: AircraftType.Longbow,
    beamMode: 'burst',
    duration: 265,
    intensity: 1.46,
    lineWidth: 2,
    headSize: 3,
    impactTint: 0x9dffcf,
  },
  [AircraftType.Mig]: {
    id: AircraftType.Mig,
    beamMode: 'projectile',
    duration: 380,
    intensity: 1.62,
    lineWidth: 2.5,
    headSize: 4.2,
    impactTint: 0xff6b4d,
  },
  [AircraftType.Yak]: {
    id: AircraftType.Yak,
    beamMode: 'strafe',
    duration: 140,
    intensity: 0.95,
    lineWidth: 1,
    headSize: 1.6,
    impactTint: 0xfff0a6,
  },
};

const FALLBACK_WEAPON: WeaponVisualDef = {
  id: 'signal',
  beamMode: 'shell_light',
  duration: 170,
  intensity: 0.75,
  lineWidth: 1.5,
  headSize: 2,
};

export function resolveWeaponVisualId(
  _kind: 'structure' | 'unit' | 'infantry' | 'aircraft',
  type: string,
): string {
  return WEAPON_VISUALS[type]?.id ?? FALLBACK_WEAPON.id;
}

export function getWeaponVisual(weaponId: string): WeaponVisualDef {
  return WEAPON_VISUALS[weaponId] ?? FALLBACK_WEAPON;
}

export function weaponDamageHint(weaponId: string): number {
  const visual = getWeaponVisual(weaponId);
  return Math.round(8 + visual.intensity * 28);
}
