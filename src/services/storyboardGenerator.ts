import {
  SCENE_POOL,
  SHOOTING_ANGLES,
  POSE_LIBRARY,
} from '../data/storyboardPool';
import { IMAGE_POSE_PRESETS } from '../data/presetPoses';
import type { ScenePool, ShootingAngle, PoseEntry } from '../data/storyboardPool';
import type { GirlfriendPreset } from '../data/girlfriendPresets';

export interface StoryboardPanel {
  panel_number: number;
  scene_description: string;
  image_prompt: string;
  shooting_angle: string;
  pose: string;
  scene_id: string;
}

export interface GeneratedStoryboard {
  scene: ScenePool;
  panels: StoryboardPanel[];
  is_r18: boolean;
}

// ─── Pose pool merger ───────────────────────────────────────────────────────────
const MERGED_POSE_POOL: PoseEntry[] = (() => {
  const seen = new Set<string>();
  const result: PoseEntry[] = [];

  for (const p of POSE_LIBRARY) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      result.push({ ...p, r18: true });
    }
  }

  for (const p of IMAGE_POSE_PRESETS) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      result.push({ id: p.id, name: p.name, nameZh: p.nameZh, prompt: p.prompt, r18: true });
    }
  }

  return result;
})();

// ─── SM tag pools (diverse categories, no repetition within selection) ──────────

const SM_RESTRAINTS = [
  'handcuffs',
  'rope bondage',
  'Shibari rope ties',
  'silk scarves binding wrists',
  'leather wrist restraints',
  'chain restraints',
  'metal collar and chain',
  'ball gag',
  'leather harness with leash',
  'suspension bondage',
  'spreader bar',
  'wrist cuffs and ankle cuffs',
  'silk blindfold',
  'latex hood',
  'stuffed leather body harness',
  'latex body suit with zipper',
  'zip tie restraints',
];

const SM_CLOTHING = [
  'latex bodysuit',
  'latex catsuit',
  'leather corset and fishnet stockings',
  'latex mini skirt and choker',
  'garter belt and lace stockings',
  'latex thigh-high boots',
  'bustier corset top with garter',
  'latex catsuit with zippers',
  'vinyl mini dress and gloves',
  'nylon stockings and heels',
  'latex bodysuit and fishnets',
  'lingerie set with garter belt',
  'latex gloves and apron',
  'skin-tight vinyl catsuit',
  'latex bodysuit, hood, gloves',
];

const SM_TOYS = [
  'vibrator nearby',
  'riding crop in hand',
  'feather tickler nearby',
  'butt plug nearby',
  'whip resting nearby',
  'floggers on table',
  'paddle resting nearby',
  'syringe with oil nearby',
  'rope coil on floor',
  'leather flogger nearby',
  'anal beads nearby',
  'massage oil on skin',
  'wooden paddle nearby',
  'rubber ballgag nearby',
  'satin blindfold',
  'spanking paddle',
  'cane resting nearby',
];

const SM_SCENES = [
  'BDSM session, dominant mood',
  'submission and restraint theme',
  'bondage and control atmosphere',
  'forced posture, submissive pose',
  'total power exchange dynamic',
  'kneeling, head bowed in submission',
  'tied up in spread eagle position',
  'on all fours in training posture',
  'suspended from ceiling restraints',
  'bound and restrained in cage',
  'tied to bedpost, restrained',
  'chained to wall, restrained',
  'forced doggystyle pose, restrained',
  'kneeling on pillow, restrained',
  'hands behind back, kneeling',
];

const SM_BODY = [
  'wet skin glistening with body oil',
  'sweat dripping on skin',
  'saliva dripping from mouth',
  'body oil rubdown, glossy skin',
  'wet glistening inner thighs',
  'slightly wet hair, wet look',
  'body mist or perfume',
  'dripping wet, extremely aroused',
  'lotion on skin, shiny',
  'sweat on forehead',
];

// Choose `count` items from pools in round-robin, no duplicates
function selectFromPools(seed: number, pools: string[][], count: number): string[] {
  const selected: string[] = [];
  const poolCount = pools.length;
  let poolIdx = 0;
  let offset = seed % 100;

  while (selected.length < count && poolIdx < poolCount * 10) {
    const pool = pools[poolIdx % poolCount];
    const item = pool[(poolIdx + offset) % pool.length];
    if (!selected.includes(item)) {
      selected.push(item);
    }
    poolIdx++;
    if (poolIdx % poolCount === 0) offset = (offset * 7 + 3) % 100;
  }

  return selected;
}

// ─── Core utilities ─────────────────────────────────────────────────────────────

function shuffleWithSeed<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor((seed * 9301 + 49297 + i * 7) % (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function pickRandom<T>(arr: T[], seed: number): T {
  const idx = Math.floor((seed * 7919) % arr.length);
  return arr[idx < 0 ? 0 : idx];
}

function buildCharacterAnchor(girlfriend: GirlfriendPreset | null): string {
  if (!girlfriend) return '';
  const charName = girlfriend.nameZh || girlfriend.name;
  const charId = girlfriend.id.toUpperCase().slice(0, 4);
  return `Strictly preserve the exact identity, character, and features of ${charName} (ID:${charId}) from the reference image. Do not alter the character at all.`;
}

// ─── Layered prompt builder ──────────────────────────────────────────────────────
// The prompt is built in coherent LAYERS so elements don't contradict:
// Layer 1: Character anchor (if any)
// Layer 2: Subject + pose action  ← pose prompt supplies this
// Layer 3: Clothing state          ← exactly one: nude / lingerie / costume / etc.
// Layer 4: Scene / location
// Layer 5: Lighting / atmosphere
// Layer 6: Camera angle
// Layer 7: Quality
// Layer 8: R18 style (if active)   ← controlled density, no contradictions
// Layer 9: SM elements (if active) ← from diverse pools, never same category twice

type ClothingState = 'nude' | 'lingerie' | 'costume' | 'casual' | 'latex';

function pickClothingState(panelIdx: number, panelCount: number, smIntensity: number, seed: number): ClothingState {
  const progress = panelIdx / Math.max(panelCount - 1, 1);
  const roll = (seed * 17 + panelIdx * 31) % 100;

  // Early panels → more covered; later panels → more revealing
  if (progress < 0.3) {
    if (smIntensity >= 5 && roll < 30) return 'latex';
    if (roll < 60) return 'lingerie';
    return 'costume';
  } else if (progress < 0.6) {
    if (smIntensity >= 3 && roll < 25) return 'latex';
    if (smIntensity >= 5 && roll < 50) return 'nude';
    if (roll < 40) return 'lingerie';
    return 'costume';
  } else {
    if (smIntensity >= 2 && roll < 40) return 'nude';
    if (smIntensity >= 5 && roll < 60) return 'latex';
    if (roll < 50) return 'lingerie';
    return 'costume';
  }
}

function buildClothingLayer(state: ClothingState, panelIdx: number, seed: number): string[] {
  const idx = (seed + panelIdx * 13) % 100;

  switch (state) {
    case 'nude':
      return ['fully naked', 'no clothes', 'completely nude body'];
    case 'lingerie':
      return [
        ['silk lingerie set', 'lace bra and panties', 'garter belt with stockings'],
        ['black lace underwear', 'sheer lace bra', 'silk stockings'],
        ['white lace lingerie', 'lace garter belt', 'silk stockings'],
        ['red lace lingerie set', 'silk stockings', 'matching garter'],
      ][idx % 4];
    case 'latex':
      return [
        ['latex bodysuit, skin-tight', 'glossy latex surface'],
        ['latex catsuit, hood and gloves'],
        ['vinyl mini dress and thigh-high boots'],
        ['latex mini skirt, bustier top, fishnets'],
      ][idx % 4];
    case 'costume':
      return [
        ['nurse outfit with white stockings'],
        ['schoolgirl uniform, plaid skirt'],
        ['maid outfit with apron'],
        ['bunny suit, ears and tail'],
        ['silk robe falling open'],
        ['cheerleader outfit, short skirt'],
        ['leather corset, mini skirt'],
      ][idx % 7];
    case 'casual':
      return [
        ['casual summer dress, bare shoulders'],
        ['loose blouse, short skirt'],
        ['tank top, denim shorts'],
        ['silk negligee'],
      ][idx % 4];
  }
}

function buildR18StyleLayer(
  panelIdx: number,
  panelCount: number,
  smIntensity: number,
  panelSeed: number,
  clothingState: ClothingState,
): string[] {
  const isLatePanel = panelIdx >= Math.floor(panelCount * 0.5);
  const progress = panelIdx / Math.max(panelCount - 1, 1);

  const tags: string[] = [];

  // Base erotic atmosphere — always present in R18
  tags.push('erotic atmosphere, sensual, seductive expression');
  tags.push('realistic body, natural skin texture, skin pores visible');
  tags.push('ultra realistic, 8K, perfect anatomy, cinematic composition');

  // Body fluid/oil — not for nude state (already nude), good for lingerie/costume
  if (clothingState !== 'nude') {
    const fluidIdx = (panelSeed * 7) % SM_BODY.length;
    tags.push(SM_BODY[fluidIdx]);
  }

  // Sensual detail for mid panels
  if (progress >= 0.2 && progress < 0.8) {
    tags.push('soft intimate lighting, warm glow on skin');
    tags.push('sensual mood, suggestive pose');
  }

  // Late panels — explicit content
  if (isLatePanel) {
    tags.push('ass visible, thighs spread, cleavage visible');
    tags.push('wet pussy, glistening arousal');
    tags.push('extreme close-up, POV shot');
    if (progress >= 0.8) {
      tags.push('hardcore, explicit sexual content');
    }
  }

  // SM intensity adds from pools — distinct categories each time
  if (smIntensity > 0) {
    const smPools = [SM_RESTRAINTS, SM_CLOTHING, SM_TOYS, SM_SCENES];
    const count = smIntensity === 1 ? 1 : Math.floor(smIntensity * 0.8) + 1;
    const smTags = selectFromPools(panelSeed, smPools, count);

    // For latex/clothing state, avoid picking from SM_CLOTHING (it would duplicate)
    const filteredSmTags = clothingState === 'latex'
      ? smTags.filter(t => !SM_CLOTHING.some(c => t.startsWith(c.split(',')[0])))
      : smTags;
    tags.push(...filteredSmTags.slice(0, count));
  }

  return tags;
}

function buildQualityTags(isR18: boolean): string[] {
  if (isR18) {
    return [
      'masterpiece, best quality, high quality',
      'very aesthetic, raw photo, detailed',
      '8k ultra clear, photorealistic',
    ];
  }
  return [
    'masterpiece, best quality, high quality',
    'very aesthetic, absurdres, incredibly absurdres',
  ];
}

// ─── Main export ────────────────────────────────────────────────────────────────

export function generateStoryboard(
  panelCount: 5 | 9 | 12 | 20,
  r18: boolean,
  girlfriend: GirlfriendPreset | null,
  poseMode: boolean = false,
  smIntensity: number = 1,
): GeneratedStoryboard {
  const seed = Date.now();

  const availableScenes = r18 || poseMode || smIntensity > 0
    ? SCENE_POOL
    : SCENE_POOL.filter((s) => !s.r18);

  const scene = pickRandom(availableScenes, seed);
  const angles = shuffleWithSeed(SHOOTING_ANGLES, seed + 1);

  const basePosePool = poseMode
    ? MERGED_POSE_POOL
    : POSE_LIBRARY.filter((p) => !r18 && !smIntensity ? !p.r18 : true);

  const shuffledPoses = shuffleWithSeed(basePosePool, seed + 2);

  const panels: StoryboardPanel[] = [];
  const isPanelR18 = r18 || poseMode || smIntensity > 0;

  for (let i = 0; i < panelCount; i++) {
    const angle = angles[i % angles.length];
    const pose = shuffledPoses[i % shuffledPoses.length];
    const panelSeed = seed + i * 137 + angle.id.length * 3;

    const panelNum = i + 1;
    const characterPart = buildCharacterAnchor(girlfriend);

    // Layer 1: Character anchor
    const layer1: string[] = characterPart ? [characterPart] : [];

    // Layer 2: Subject + pose
    const layer2 = [`1girl, ${pose.prompt}`];

    // Layer 3: Clothing state (R18 only — non-R18 is clean)
    let clothingState: ClothingState = 'casual';
    let layer3: string[] = [];

    if (isPanelR18) {
      clothingState = pickClothingState(i, panelCount, smIntensity, panelSeed);
      layer3 = buildClothingLayer(clothingState, i, panelSeed);
    }

    // Layer 4: Scene
    const layer4 = [`in ${scene.location}`, `${scene.atmosphere}`];

    // Layer 5: Lighting
    const layer5 = [scene.lighting];

    // Layer 6: Camera
    const layer6 = [angle.shot];

    // Layer 7: Quality
    const layer7 = buildQualityTags(isPanelR18);

    // Layer 8: R18 style tags (controlled, non-contradicting)
    const layer8 = isPanelR18
      ? buildR18StyleLayer(i, panelCount, smIntensity, panelSeed, clothingState)
      : [];

    // Compose — layers are joined with commas within themselves, layers joined with commas
    const allLayers = [
      ...layer1,
      ...layer2,
      ...layer3,
      ...layer4,
      ...layer5,
      ...layer6,
      ...layer7,
      ...layer8,
    ].filter(Boolean);

    const image_prompt = allLayers.join(', ');

    const scene_description =
      `【第${panelNum}镜 · ${scene.nameZh}】` +
      `${angle.descriptionZh}，` +
      `${pose.nameZh}。` +
      `${scene.locationZh}。` +
      `${scene.lightingZh}。` +
      `${scene.atmosphereZh}。`;

    panels.push({
      panel_number: panelNum,
      scene_description,
      image_prompt,
      shooting_angle: `${angle.nameZh}（${angle.shot}）`,
      pose: pose.nameZh,
      scene_id: scene.id,
    });
  }

  return { scene, panels, is_r18: isPanelR18 };
}
