import type { VideoPosePreset } from '../data/presetPoses';

/** 195 个视频姿势预设 → MiniMax H3 六段式、9 个 shot */
function sceneForPose(pose: VideoPosePreset): string {
  const text = `${pose.name} ${pose.nameZh} ${pose.prompt}`.toLowerCase();
  const explicit: Array<[RegExp, string]> = [
    [/海边|沙滩|beach|seaside|ocean/, 'secluded beach at golden hour, sand, waves, open sky'],
    [/泳池|pool/, 'private poolside, water reflections, lounge chair'],
    [/厨房|kitchen/, 'modern kitchen, countertop, warm under-cabinet light'],
    [/阳台|balcony/, 'apartment balcony at dusk, city lights, railing'],
    [/楼梯|staircase|stairs/, 'wooden staircase, handrail, narrow landing'],
    [/汽车|车|car|backseat/, 'car backseat, fogged windows, street lights outside'],
    [/电梯|elevator/, 'mirror-lined elevator, cold overhead light'],
    [/办公室|办公桌|office|desk/, 'office desk, monitor glow, floor-to-ceiling window at night'],
    [/教室|classroom|podium/, 'empty classroom, podium, chalkboard, afternoon light'],
    [/阁楼|attic|skylight/, 'attic room under a skylight, dust in sunbeams'],
    [/镜子|mirror/, 'full-length mirror, reflected bodies, dim bedroom'],
    [/天台|rooftop/, 'rooftop at night, skyline, wind'],
    [/浴室| shower|bathroom/, 'steamy bathroom, glass shower, wet tiles'],
    [/健身房|gym/, 'private gym, rubber floor, dumbbell rack, mirror wall'],
    [/森林|forest|woods/, 'forest clearing, moss, filtered sunlight'],
    [/沙发|sofa|couch/, 'living-room sofa, cushions, warm lamp'],
    [/床|bed|bedroom/, 'bedroom, rumpled sheets, bedside lamp'],
    [/墙|wall/, 'against a plaster wall, hallway, low warm light'],
  ];
  for (const [re, scene] of explicit) if (re.test(text)) return scene;

  const hash = [...pose.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  if (/骑乘|cowgirl|riding|女上位|反向/i.test(text)) {
    return hash % 2 ? 'living-room sofa, cushions under knees, warm lamp' : 'bedroom bed, rumpled sheets, headboard';
  }
  if (/站立|standing|抱起|carry|靠墙|wall/i.test(text)) {
    return ['kitchen counter, warm pendant light', 'living-room window, city night', 'balcony railing at dusk', 'hallway wall, low warm light'][hash % 4];
  }
  if (/后入|doggy|prone|趴/i.test(text)) {
    return ['bedroom bed edge, sheets', 'living-room sofa arm, cushions', 'wooden desk, lamp'][hash % 3];
  }
  if (/传教士|missionary|抬腿/i.test(text)) {
    return ['bedroom bed, soft lamp', 'living-room sofa, cushions', 'hotel room, white sheets'][hash % 3];
  }
  return ['bedroom, warm bedside lamp', 'living-room sofa, evening light', 'hotel suite, floor-to-ceiling window'][hash % 3];
}

export function buildPoseH3Prompt(pose: VideoPosePreset): string {
  const raw = String(pose.prompt || '');
  const positive = (raw.split('负面：')[0] || raw).replace(/^正向[:：]\s*/, '').trim();
  const scene = sceneForPose(pose);
  const negative = (raw.split('负面：')[1] || '').trim();
  const cameras = [
    'wide establishing shot, full bodies and entire room visible',
    'medium frontal shot, both faces and hands visible',
    'three-quarter side shot, clear body geometry',
    'over-the-shoulder medium shot',
    'low-angle medium shot from the floor',
    'close-up on the point of contact, no face',
    'high-angle wide shot, full scene',
    'profile medium close-up, facial reaction',
    'wide ending shot, both bodies and environment visible',
  ];
  const shots = cameras.map((cam, i) => {
    const t = (i * 60 / 9).toFixed(1).padStart(4, '0');
    return `[Shot ${i + 1}] At 00:${t}.000, ${positive} Scene: ${scene}. Camera: ${cam}. Same pose, same clothing state, continuous motion from the previous shot.`;
  }).join('\n');

  return `subject_definitions:
<Subject 1> is @Woman <Picture 1> — the East Asian adult woman from the reference; preserve face, hair, body proportions and identity exactly.
<Subject 2> is @Man — an adult male partner; face stays out of close-ups unless the pose requires it.

summary:
[reference generation] A 60-second explicit adult sequence built from the "${pose.nameZh}" pose preset, set in ${scene}. Nine sequential shots of one continuous position with different camera angles and escalating physical detail.

retention_analysis:
<Subject 1> <Picture 1>: fully_preserved — face, hair and body proportions stay identical to the reference.

detailed_description:
${shots}

overall_soundscape: room tone, fabric friction, skin contact and breathing. Only the exact dialogue inside <d>...</d> tags may be spoken; no narrator, no extra voices.
non_diegetic_music: None
${negative ? `\nnegative: ${negative}` : ''}`;
}
