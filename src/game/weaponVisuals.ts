import {
  AircraftType,
  InfantryType,
  StructType,
  UnitType,
} from './definitions';

export type WeaponBeamMode =
  | 'pillbox_burst'
  | 'turret_cannon'
  | 'flame_jet'
  | 'sam_missile'
  | 'aa_flak'
  | 'tesla_arc'
  | 'tank_light'
  | 'tank_medium'
  | 'tank_heavy'
  | 'artillery_lob'
  | 'apc_autocannon'
  | 'rifle_tracer'
  | 'grenade_lob'
  | 'rocket_trail'
  | 'infantry_flame'
  | 'hind_rocket_pod'
  | 'longbow_atgm'
  | 'mig_strike'
  | 'yak_strafe';

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
    beamMode: 'pillbox_burst',
    duration: 90,
    intensity: 0.72,
    lineWidth: 1,
    headSize: 1.4,
    impactTint: 0xfff0c8,
  },
  [StructType.Turret]: {
    id: StructType.Turret,
    beamMode: 'turret_cannon',
    duration: 210,
    intensity: 1.26,
    lineWidth: 2,
    headSize: 3,
    impactTint: 0xffd29a,
  },
  [StructType.FlameTurret]: {
    id: StructType.FlameTurret,
    beamMode: 'flame_jet',
    duration: 200,
    intensity: 1.55,
    lineWidth: 3,
    headSize: 3.2,
    impactTint: 0xffb34d,
  },
  [StructType.Sam]: {
    id: StructType.Sam,
    beamMode: 'sam_missile',
    duration: 290,
    intensity: 1.48,
    lineWidth: 2,
    headSize: 3.4,
    impactTint: 0xff8a4d,
  },
  [StructType.AaGun]: {
    id: StructType.AaGun,
    beamMode: 'aa_flak',
    duration: 175,
    intensity: 1.18,
    lineWidth: 1.4,
    headSize: 2.2,
    impactTint: 0xd8f2ff,
  },
  [StructType.Tesla]: {
    id: StructType.Tesla,
    beamMode: 'tesla_arc',
    duration: 260,
    intensity: 2.1,
    lineWidth: 2,
    headSize: 3,
    impactTint: 0x8fd6ff,
  },
  [UnitType.LightTank]: {
    id: UnitType.LightTank,
    beamMode: 'tank_light',
    duration: 155,
    intensity: 1.02,
    lineWidth: 1.4,
    headSize: 2.1,
    impactTint: 0xfff0cf,
  },
  [UnitType.MediumTank]: {
    id: UnitType.MediumTank,
    beamMode: 'tank_medium',
    duration: 195,
    intensity: 1.18,
    lineWidth: 2,
    headSize: 2.6,
    impactTint: 0xffddb3,
  },
  [UnitType.HeavyTank]: {
    id: UnitType.HeavyTank,
    beamMode: 'tank_heavy',
    duration: 235,
    intensity: 1.52,
    lineWidth: 2.8,
    headSize: 3.4,
    impactTint: 0xffc18a,
  },
  [UnitType.Artillery]: {
    id: UnitType.Artillery,
    beamMode: 'artillery_lob',
    duration: 520,
    intensity: 1.9,
    lineWidth: 2,
    headSize: 5,
    impactTint: 0xffc46d,
  },
  [UnitType.Apc]: {
    id: UnitType.Apc,
    beamMode: 'apc_autocannon',
    duration: 130,
    intensity: 0.82,
    lineWidth: 1,
    headSize: 1.6,
    impactTint: 0xfff4db,
  },
  [InfantryType.Rifle]: {
    id: InfantryType.Rifle,
    beamMode: 'rifle_tracer',
    duration: 95,
    intensity: 0.62,
    lineWidth: 1,
    headSize: 1.4,
    impactTint: 0xfff0d8,
  },
  [InfantryType.Grenadier]: {
    id: InfantryType.Grenadier,
    beamMode: 'grenade_lob',
    duration: 360,
    intensity: 1.35,
    lineWidth: 2,
    headSize: 3.6,
    impactTint: 0xffb86b,
  },
  [InfantryType.Rocket]: {
    id: InfantryType.Rocket,
    beamMode: 'rocket_trail',
    duration: 330,
    intensity: 1.38,
    lineWidth: 2.5,
    headSize: 3.8,
    impactTint: 0xff9a4d,
  },
  [InfantryType.Flamethrower]: {
    id: InfantryType.Flamethrower,
    beamMode: 'infantry_flame',
    duration: 180,
    intensity: 1.48,
    lineWidth: 3,
    headSize: 2.8,
    impactTint: 0xffb34d,
  },
  [AircraftType.Hind]: {
    id: AircraftType.Hind,
    beamMode: 'hind_rocket_pod',
    duration: 250,
    intensity: 1.42,
    lineWidth: 2,
    headSize: 3.2,
    impactTint: 0xff7a3d,
  },
  [AircraftType.Longbow]: {
    id: AircraftType.Longbow,
    beamMode: 'longbow_atgm',
    duration: 265,
    intensity: 1.46,
    lineWidth: 2,
    headSize: 3,
    impactTint: 0x9dffcf,
  },
  [AircraftType.Mig]: {
    id: AircraftType.Mig,
    beamMode: 'mig_strike',
    duration: 380,
    intensity: 1.62,
    lineWidth: 2.5,
    headSize: 4.2,
    impactTint: 0xff6b4d,
  },
  [AircraftType.Yak]: {
    id: AircraftType.Yak,
    beamMode: 'yak_strafe',
    duration: 140,
    intensity: 0.95,
    lineWidth: 1,
    headSize: 1.6,
    impactTint: 0xfff0a6,
  },
};

const FALLBACK_WEAPON: WeaponVisualDef = {
  id: 'signal',
  beamMode: 'rifle_tracer',
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
